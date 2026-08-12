import { z } from "zod";
import {
  inputRequired,
  acceptedContent,
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
 * The distinction that matters: an unconfirmed call is not an error the model
 * can retry its way past, it is a request for information the model does not
 * have. It cannot answer on the user's behalf.
 */

const CONFIRM_KEY = "confirm";

const ConfirmSchema = z.object({
  confirm: z.boolean(),
});

/** One line of the summary shown to the user before they approve. */
export type ConfirmLine = [label: string, value: string | number | undefined];

export interface ConfirmRequest {
  /** Short imperative title, e.g. "Start live deployment". */
  action: string;
  /** Facts the user needs to make the decision. Undefined values are dropped. */
  details: ConfirmLine[];
  /** What becomes true once this runs. Stated plainly, no hedging. */
  consequence: string;
}

function renderPrompt({ action, details, consequence }: ConfirmRequest): string {
  const rows = details
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `• ${label}: ${value}`)
    .join("\n");

  return `${action}\n\n${rows}\n\n${consequence}`;
}

export type ConfirmOutcome =
  | { approved: true }
  | { approved: false; result: InputRequiredResult | CallToolResult };

/**
 * Returns `{ approved: true }` only when the current request carries an
 * explicit affirmative. Otherwise returns the value the tool must return, which
 * either asks for confirmation or reports the refusal.
 *
 * Call this before any side effect and return `outcome.result` verbatim when
 * `approved` is false:
 *
 * ```ts
 * const outcome = requireConfirmation(ctx, { action: "...", details: [...], consequence: "..." });
 * if (!outcome.approved) return outcome.result;
 * ```
 */
export function requireConfirmation(
  ctx: ServerContext | undefined,
  request: ConfirmRequest,
): ConfirmOutcome {
  const answer = acceptedContent(
    ctx?.mcpReq?.inputResponses as never,
    CONFIRM_KEY,
    ConfirmSchema,
  );

  if (answer?.confirm === true) {
    return { approved: true };
  }

  // A client that cannot elicit cannot carry a confirmation, and the SDK
  // rejects the request with -32021 rather than asking. Refuse here instead, so
  // the caller gets an explanation rather than a bare protocol error — and so
  // the action stays unperformed either way. Never fall through to executing.
  // The shipped 2.0.0 declarations type RequestMetaEnvelope as `{}`, so the
  // envelope's well-known keys are not indexable without a cast. The runtime
  // value does carry them, keyed by the spec's reverse-DNS names.
  const envelope = (ctx?.mcpReq?.envelope ?? {}) as Record<string, unknown>;
  const capabilities = (envelope[CLIENT_CAPABILITIES_META_KEY] ?? {}) as {
    elicitation?: { form?: unknown };
  };

  if (!capabilities.elicitation?.form) {
    return {
      approved: false,
      result: {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `${request.action} requires the user's explicit confirmation, and this client ` +
              `cannot present one (it does not support form elicitation). Nothing was changed. ` +
              `Perform this action from a client that supports confirmation prompts, or from ` +
              `https://account.superior.trade.`,
          },
        ],
      },
    };
  }

  // An explicit "no" is a decision, not a prompt to ask again. Re-issuing the
  // elicitation here would let a model badger a user who already declined.
  if (answer?.confirm === false) {
    return {
      approved: false,
      result: {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Declined by the user — ${request.action.toLowerCase()} was not performed. Nothing was changed.`,
          },
        ],
      },
    };
  }

  return {
    approved: false,
    result: inputRequired({
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
