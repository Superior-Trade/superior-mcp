import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  inputRequired,
  acceptedContent,
  createRequestStateCodec,
  CLIENT_CAPABILITIES_META_KEY,
  type InputRequiredResult,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";

/**
 * Server-enforced confirmation for actions that move real money.
 *
 * Until the 2026-07-28 revision the only way to gate a live deployment was to
 * write "ask the user first" into a skill and trust the calling model to obey.
 * The server executed whatever it was told. Multi Round-Trip Requests move the
 * gate into the protocol: the tool returns `input_required` instead of acting,
 * and the client must come back with an explicit answer before the handler
 * reaches the API call.
 *
 * An approval is bound to the exact call it was granted for. The approval
 * travels through the client, which makes it attacker-controlled input: without
 * binding, the blob a user approved for one deployment starts a different one,
 * and the blob approved for "start" satisfies "delete". The binding is an HMAC
 * over the tool name and arguments, minted when we ask and verified when the
 * answer comes back.
 */

const CONFIRM_KEY = "confirm";

const ConfirmSchema = z.object({ confirm: z.boolean() });

/**
 * A stdio server is one process serving one client, so a per-process key is
 * sufficient and needs no operator setup. A hosted transport serves many
 * clients across restarts and must supply a stable key, or approvals minted
 * before a restart stop verifying.
 */
const STATE_KEY = process.env.SUPERIOR_MCP_STATE_KEY ?? randomBytes(32).toString("hex");

interface ConfirmationBinding {
  tool: string;
  args: string;
}

export const requestStateCodec = createRequestStateCodec<ConfirmationBinding>({
  key: STATE_KEY,
});

/** Stable fingerprint of the arguments the user is approving. */
function fingerprint(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? null))
    .digest("hex")
    .slice(0, 32);
}

/** One line of the summary shown to the user before they approve. */
export type ConfirmLine = [label: string, value: string | number | undefined];

export interface ConfirmRequest {
  /** Short imperative title, e.g. "Start live deployment". */
  action: string;
  /** Facts the user needs to make the decision. Undefined values are dropped. */
  details: ConfirmLine[];
  /** What becomes true once this runs. Stated plainly, no hedging. */
  consequence: string;
  /** The tool asking. Half of what the approval is bound to. */
  tool: string;
  /** The arguments being approved. The other half of the binding. */
  args: unknown;
}

function renderPrompt({ action, details, consequence }: ConfirmRequest): string {
  const rows = details
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `• ${label}: ${value}`)
    .join("\n");

  return `${action}\n\n${rows}\n\n${consequence}`;
}

const refusal = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text" as const, text }],
});

export type ConfirmOutcome =
  | { approved: true }
  | { approved: false; result: InputRequiredResult | CallToolResult };

/**
 * Returns `{ approved: true }` only when this exact call carries an explicit
 * affirmative that was granted for this exact call. Otherwise returns the value
 * the tool must return.
 *
 * Call before any side effect and return `outcome.result` verbatim when
 * `approved` is false.
 */
export async function requireConfirmation(
  ctx: ServerContext | undefined,
  request: ConfirmRequest,
): Promise<ConfirmOutcome> {
  const responses = ctx?.mcpReq?.inputResponses as
    | Record<string, { action?: string } | undefined>
    | undefined;
  const reply = responses?.[CONFIRM_KEY];

  // A decline or cancel is a decision. `acceptedContent` returns undefined for
  // both, so testing only the boolean would fall through and re-issue the
  // prompt — letting a model badger a user who already said no.
  if (reply && reply.action !== "accept") {
    return {
      approved: false,
      result: refusal(
        `Declined by the user — ${request.action.toLowerCase()} was not performed. Nothing was changed.`,
      ),
    };
  }

  const answer = acceptedContent(responses as never, CONFIRM_KEY, ConfirmSchema);

  // Accepted the form but answered "no". Same decision as a decline.
  if (answer?.confirm === false) {
    return {
      approved: false,
      result: refusal(
        `Declined by the user — ${request.action.toLowerCase()} was not performed. Nothing was changed.`,
      ),
    };
  }

  if (answer?.confirm === true) {
    // The answer is only worth acting on if it was granted for THIS call.
    const state = ctx?.mcpReq?.requestState?.<ConfirmationBinding>();
    const boundTo =
      state && typeof state === "object" && "tool" in state
        ? (state as ConfirmationBinding)
        : undefined;

    if (!boundTo) {
      return {
        approved: false,
        result: refusal(
          `${request.action} was not performed: the confirmation did not carry the server's approval token. ` +
            `Re-issue the request so the user can be asked directly.`,
        ),
      };
    }

    if (boundTo.tool !== request.tool || boundTo.args !== fingerprint(request.args)) {
      return {
        approved: false,
        result: refusal(
          `${request.action} was not performed: the confirmation was granted for a different action ` +
            `(${boundTo.tool}) and cannot be reused here. Nothing was changed.`,
        ),
      };
    }

    return { approved: true };
  }

  // On the 2026-07-28 wire a client that cannot elicit cannot carry a
  // confirmation, and the SDK rejects the attempt with -32021. Refuse here
  // instead so the caller gets an explanation rather than a bare protocol
  // error. Only applied on the modern path: a legacy connection carries no
  // envelope, and the SDK's shim fulfils the elicitation as a server-to-client
  // request, so short-circuiting there would make these tools permanently
  // unusable for every 2025-era client.
  const envelope = ctx?.mcpReq?.envelope as Record<string, unknown> | undefined;
  const isModernWire = envelope !== undefined && Object.keys(envelope).length > 0;

  if (isModernWire) {
    const capabilities = (envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? {}) as {
      elicitation?: { form?: unknown };
    };
    if (!capabilities.elicitation?.form) {
      return {
        approved: false,
        result: refusal(
          `${request.action} requires the user's explicit confirmation, and this client cannot ` +
            `present one (it does not support form elicitation). Nothing was changed. Perform this ` +
            `action from a client that supports confirmation prompts, or from https://account.superior.trade.`,
        ),
      };
    }
  }

  return {
    approved: false,
    result: inputRequired({
      requestState: await requestStateCodec.mint({
        tool: request.tool,
        args: fingerprint(request.args),
      }),
      inputRequests: {
        [CONFIRM_KEY]: inputRequired.elicit({
          message: renderPrompt(request),
          requestedSchema: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                description: `Confirm: ${request.action}. This cannot be undone by the agent.`,
              },
            },
            required: ["confirm"],
          },
        }),
      },
    }),
  };
}
