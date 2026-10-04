/**
 * Start Move → Join Chain hand-off.
 *
 * Start Move already knows whether the participant is selling, still searching
 * or buying only; Join Chain must not ask again. Intent carries no authority:
 * join_chain_property still requires the access code, address and postcode,
 * and Buyer Ready is created through the guarded chain_nodes insert.
 */

export const JOIN_CHAIN_SOURCE_CHAIN_PARAM = "sourceChain";
export const JOIN_CHAIN_SEARCHING_PARAM = "searching";
export const JOIN_CHAIN_NOT_SELLING_PARAM = "notSelling";

export type JoinChainIntent = {
  sourceChainId: string | null;
  searchingIntent: boolean;
  notSellingIntent: boolean;
};

export type BuildJoinExistingChainHrefParams = {
  sourceChainId: number | null;
  searching: boolean;
  notSelling: boolean;
};

/**
 * Not selling only applies to a direct join: a source chain exists precisely
 * because the participant entered a sale.
 */
export function buildJoinExistingChainHref(
  params: BuildJoinExistingChainHrefParams
): string {
  const joinParams = new URLSearchParams();

  if (params.sourceChainId != null) {
    joinParams.set(
      JOIN_CHAIN_SOURCE_CHAIN_PARAM,
      String(params.sourceChainId)
    );
  } else if (params.notSelling) {
    joinParams.set(JOIN_CHAIN_NOT_SELLING_PARAM, "1");
  }

  if (params.searching) {
    joinParams.set(JOIN_CHAIN_SEARCHING_PARAM, "1");
  }

  const query = joinParams.toString();

  return query ? `/join-chain?${query}` : "/join-chain";
}

type SearchParamsReader = {
  get(name: string): string | null;
};

export function readJoinChainIntent(
  searchParams: SearchParamsReader
): JoinChainIntent {
  const sourceChainId =
    searchParams.get(JOIN_CHAIN_SOURCE_CHAIN_PARAM) || null;

  return {
    sourceChainId,
    searchingIntent:
      searchParams.get(JOIN_CHAIN_SEARCHING_PARAM) === "1",
    notSellingIntent:
      sourceChainId == null &&
      searchParams.get(JOIN_CHAIN_NOT_SELLING_PARAM) === "1",
  };
}

export type BuyingAwaitingConnectionAction =
  | { kind: "join_after_sale" }
  | { kind: "join"; notSelling: boolean };

/** Buying address already awaits its buyer: join directly, or create the sale first. */
export function resolveBuyingAwaitingConnectionAction(params: {
  hasSellingAddress: boolean;
}): BuyingAwaitingConnectionAction {
  return params.hasSellingAddress
    ? { kind: "join_after_sale" }
    : { kind: "join", notSelling: true };
}

export function shouldCreateBuyerReadyOnJoin(params: {
  joiningRole: string | null | undefined;
  nothingToSell: boolean;
}): boolean {
  return params.joiningRole === "buyer" && params.nothingToSell;
}
