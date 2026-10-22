"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { createChainForOnboarding } from "@/lib/createChainForOnboarding";
import { createStartMoveProperty } from "@/lib/ownership/grants";
import { generateAccessCode } from "@/lib/accessCode";
import { createSearchingPlaceholderForSale } from "@/lib/searchingPlaceholder";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import DuplicatePropertyDialog, {
  type DuplicatePropertyDialogVariant,
} from "@/components/onboarding/DuplicatePropertyDialog";
import StartMoveRecoveryPanel from "@/components/onboarding/StartMoveRecoveryPanel";
import HelpLink from "@/components/help/HelpLink";
import { HELP_SECTION_IDS } from "@/lib/help/helpContent";
import type {
  StartMoveRecovery,
  StartMoveRecoveryReason,
} from "@/lib/onboarding/startMoveRecovery";
import PropertyAddressLookup from "@/components/address/PropertyAddressLookup";
import { formatUkPostcodeForStorage } from "@/lib/address/normalize";
import { checkStartMoveAddress } from "@/lib/onboarding/addressReservation";
import { linkStartMoveOnwardPurchase } from "@/lib/onboarding/startMoveOnwardPurchase";
import {
  buildJoinExistingChainHref,
  resolveBuyingAwaitingConnectionAction,
} from "@/lib/onboarding/joinChainIntent";
import {
  clearJoinAddressHandoff,
  setJoinAddressHandoff,
} from "@/lib/onboarding/joinAddressHandoff";
import {
  EMPTY_START_MOVE_ANSWERS,
  findMissingStartMoveAddress,
  isStartMoveAddressComplete,
  nextStartMoveStep,
  resolveStartMovePlan,
  selectStartMoveAddresses,
  START_MOVE_FIRST_STEP,
  type StartMoveAnswers,
  type StartMoveQuestion,
  type StartMoveSelectedAddresses,
  type StartMoveStep,
  type YesNo,
} from "@/lib/onboarding/startMoveJourney";

/** The address Join Chain pre-fills; held in memory only, never in the URL. */
type CarriedJoinAddress = {
  userId: string;
  address: string;
  postcode: string;
  /** Accepted onward purchase, added only after a successful seller-side join. */
  onwardPurchase?: { address: string; postcode: string } | null;
};

type PendingDuplicateAction =
  /** The caller's own chain already holds the address. */
  | { kind: "open_chain"; chainId: number | null }
  /** Join without a source chain (nothing created yet). */
  | { kind: "join"; notSelling: boolean; carried: CarriedJoinAddress }
  /** Create the caller's sale first, then join carrying it across. */
  | { kind: "join_after_sale" }
  /** A source chain was already created; Join Chain migrates and removes it. */
  | {
      kind: "join_source_chain";
      chainId: number;
      carried: CarriedJoinAddress;
      /** The sale already exists; cancelling must keep the chain. */
      preserveSourceChain: boolean;
    }
  | { kind: "none" };

const START_MOVE_FAILED_MESSAGE =
  "We could not create your chain. Please try again.";

const START_MOVE_ADDRESS_RESERVED_MESSAGE =
  "One of these addresses has just been added to MoveLoop by someone else. Please try again and we will show you how to join it.";

const START_MOVE_INCOMPLETE_ANSWERS_MESSAGE =
  "Please answer the questions above before creating your chain.";

const START_MOVE_MISSING_ADDRESS_MESSAGE =
  "Select the property address, or enter the address and postcode manually.";

const STEP_SECTION_LABEL: Record<StartMoveStep, string> = {
  selling: "Your sale",
  saleAgreed: "Your sale",
  saleAddress: "Your sale",
  buying: "Your purchase",
  offerAccepted: "Your purchase",
  purchaseAddress: "Your purchase",
  review: "Check your details",
  stop_sale_not_agreed: "Your sale",
  stop_nothing_to_add: "Your move",
  stop_no_offer_accepted: "Your purchase",
};

/** The address was taken between routing and creation. */
function isAddressReservedFailure(error: string) {
  return error === "address_reserved" || error === "address_unavailable";
}

export default function StartMovePage() {
  const router = useRouter();

  const [answers, setAnswers] =
    useState<StartMoveAnswers>(EMPTY_START_MOVE_ANSWERS);
  const [stepHistory, setStepHistory] = useState<StartMoveStep[]>([
    START_MOVE_FIRST_STEP,
  ]);
  const [duplicateDialogOpen, setDuplicateDialogOpen] =
    useState(false);
  const [duplicateDialogVariant, setDuplicateDialogVariant] =
    useState<DuplicatePropertyDialogVariant>("existing");
  const [pendingDuplicateAction, setPendingDuplicateAction] =
    useState<PendingDuplicateAction>({ kind: "none" });
  const [isSubmitting, setIsSubmitting] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [recovery, setRecovery] =
    useState<StartMoveRecovery | null>(null);
  const [sellingAddress, setSellingAddress] =
    useState("");

  const [sellingPostcode, setSellingPostcode] =
    useState("");

  const [buyingAddress, setBuyingAddress] =
    useState("");

  const [buyingPostcode, setBuyingPostcode] =
    useState("");

  const step = stepHistory[stepHistory.length - 1];
  const plan = resolveStartMovePlan(answers);
  const moveFlags = plan.kind === "move" ? plan.flags : null;
  const selectedAddresses: StartMoveSelectedAddresses = moveFlags
    ? selectStartMoveAddresses(moveFlags, {
        selling: { address: sellingAddress, postcode: sellingPostcode },
        buying: { address: buyingAddress, postcode: buyingPostcode },
      })
    : { selling: null, buying: null };

  function answerQuestion(question: StartMoveQuestion, value: YesNo) {
    const nextAnswers = { ...answers, [question]: value };
    setAnswers(nextAnswers);
    setStepHistory((history) => [
      ...history,
      nextStartMoveStep(question, nextAnswers),
    ]);
    setErrorMessage("");
  }

  function continueFromAddressStep(
    addressStep: "saleAddress" | "purchaseAddress"
  ) {
    const entered =
      addressStep === "saleAddress"
        ? { address: sellingAddress, postcode: sellingPostcode }
        : { address: buyingAddress, postcode: buyingPostcode };

    if (!isStartMoveAddressComplete(entered)) {
      setErrorMessage(START_MOVE_MISSING_ADDRESS_MESSAGE);
      return;
    }

    setErrorMessage("");
    setStepHistory((history) => [
      ...history,
      nextStartMoveStep(addressStep, answers),
    ]);
  }

  function goBack() {
    setErrorMessage("");
    setStepHistory((history) =>
      history.length > 1 ? history.slice(0, -1) : history
    );
  }

    function redirectToJoinExistingChain(
      chainId: number | null,
      options: { notSelling?: boolean; carried?: CarriedJoinAddress } = {}
    ) {
      if (options.carried) {
        setJoinAddressHandoff(options.carried);
      } else {
        clearJoinAddressHandoff();
      }

      setIsSubmitting(true);
      router.push(
        buildJoinExistingChainHref({
          sourceChainId: chainId,
          // A carried purchase is converted from the Searching step, which
          // also remains the fallback if the in-memory hand-over is lost.
          searching:
            moveFlags?.searchingForProperty === true ||
            options.carried?.onwardPurchase != null,
          notSelling: options.notSelling === true,
        })
      );
    }

    function openDuplicateDialog(
      variant: DuplicatePropertyDialogVariant,
      action: PendingDuplicateAction
    ) {
      setDuplicateDialogVariant(variant);
      setPendingDuplicateAction(action);
      setDuplicateDialogOpen(true);
    }

    function promptJoinExistingChain(
      chainId: number,
      carried: CarriedJoinAddress,
      preserveSourceChain: boolean
    ) {
      openDuplicateDialog("existing", {
        kind: "join_source_chain",
        chainId,
        carried,
        preserveSourceChain,
      });
    }

    async function cleanupOnboardingChain(chainId: number) {
      const { error } = await supabase.rpc(
        "cleanup_abandoned_onboarding_chain",
        { p_chain_id: chainId }
      );

      if (error) {
        console.error(
          "[start-move] onboarding cleanup failed:",
          error.message
        );
      }
    }

    /** Returns true when routing took over and nothing should be created. */
    async function routeExistingAddresses(
      userId: string
    ): Promise<boolean> {
      const sellingSelection = selectedAddresses.selling;
      const buyingSelection = selectedAddresses.buying;
      const onwardPurchase = buyingSelection
        ? {
            address: buyingSelection.address,
            postcode: formatUkPostcodeForStorage(
              buyingSelection.postcode
            ),
          }
        : null;

      if (sellingSelection) {
        const sellingPostcodeStored = formatUkPostcodeForStorage(
          sellingSelection.postcode
        );
        const selling = await checkStartMoveAddress(supabase, {
          address: sellingSelection.address,
          postcode: sellingPostcodeStored,
          side: "selling",
        });

        if (!selling.ok) {
          setErrorMessage(selling.message);
          return true;
        }

        if (selling.state === "yours") {
          openDuplicateDialog("yours", {
            kind: "open_chain",
            chainId: selling.chainId,
          });
          return true;
        }

        if (selling.state === "awaiting_connection") {
          openDuplicateDialog(
            onwardPurchase
              ? "awaiting_seller_with_purchase"
              : "awaiting_seller",
            {
              kind: "join",
              notSelling: false,
              carried: {
                userId,
                address: sellingSelection.address,
                postcode: sellingPostcodeStored,
                onwardPurchase,
              },
            }
          );
          return true;
        }

        if (selling.state === "already_represented") {
          openDuplicateDialog("represented", { kind: "none" });
          return true;
        }
      }

      if (buyingSelection) {
        const buyingPostcodeStored = formatUkPostcodeForStorage(
          buyingSelection.postcode
        );
        const buying = await checkStartMoveAddress(supabase, {
          address: buyingSelection.address,
          postcode: buyingPostcodeStored,
          side: "buying",
        });

        if (!buying.ok) {
          setErrorMessage(buying.message);
          return true;
        }

        if (buying.state === "yours") {
          openDuplicateDialog("yours", {
            kind: "open_chain",
            chainId: buying.chainId,
          });
          return true;
        }

        if (buying.state === "awaiting_connection") {
          const buyingAction = resolveBuyingAwaitingConnectionAction({
            hasSellingAddress: sellingSelection != null,
          });

          openDuplicateDialog(
            "awaiting_buyer",
            buyingAction.kind === "join"
              ? {
                  ...buyingAction,
                  carried: {
                    userId,
                    address: buyingSelection.address,
                    postcode: buyingPostcodeStored,
                  },
                }
              : buyingAction
          );
          return true;
        }

        if (buying.state === "already_represented") {
          openDuplicateDialog("represented", { kind: "none" });
          return true;
        }
      }

      return false;
    }

    async function handleStartMove(
      options: { joinBuyingAfterSale?: boolean } = {}
    ) {
      if (isSubmitting) {
        return;
      }

      if (!moveFlags) {
        setErrorMessage(START_MOVE_INCOMPLETE_ANSWERS_MESSAGE);
        return;
      }

      if (findMissingStartMoveAddress(moveFlags, selectedAddresses)) {
        setErrorMessage(START_MOVE_MISSING_ADDRESS_MESSAGE);
        return;
      }

      const { notSelling, notBuying, searchingForProperty } = moveFlags;
      const selling = selectedAddresses.selling;
      const buying = selectedAddresses.buying;

      setIsSubmitting(true);
      setErrorMessage("");

      let chainId: number | null = null;
      let redirected = false;
      /** Set once a property exists with the caller's homeowner access. */
      let propertyEstablished = false;

      async function fail(
        logMessage: string,
        detail?: unknown,
        userMessage: string = START_MOVE_FAILED_MESSAGE,
        recoveryReason: StartMoveRecoveryReason = "step_incomplete"
      ) {
        console.error(logMessage, detail ?? "");

        if (chainId != null && propertyEstablished) {
          setRecovery({ chainId, reason: recoveryReason });
          return;
        }

        if (chainId != null) {
          await cleanupOnboardingChain(chainId);
        }

        setErrorMessage(userMessage);
      }

      try {
    
        if (
          document.activeElement instanceof HTMLElement
        ) {
          document.activeElement.blur();
        }
    
        const {
          data: { user },
        } = await supabase.auth.getUser();
    
        if (!user) {
    
          return;
    
        }

        if (
          !options.joinBuyingAfterSale &&
          (await routeExistingAddresses(user.id))
        ) {
          return;
        }
    
        let accessCode =
          generateAccessCode();

        for (let attempt = 0; attempt < 5; attempt++) {
          const chainResult =
            await createChainForOnboarding(
              supabase,
              {
                name: `CHAIN-${Date.now()}`,
                accessCode,
              }
            );

          if (
            chainResult.error ===
              "duplicate_access_code" &&
            attempt < 4
          ) {
            accessCode =
              generateAccessCode();
            continue;
          }

          if (chainResult.error) {
            await fail(
              "[start-move] chain create failed:",
              chainResult.error
            );
            return;
          }

          chainId = chainResult.chainId;
          accessCode = chainResult.accessCode ?? accessCode;
          break;
        }

        if (chainId == null) {
          await fail(
            "[start-move] chain create failed after retries"
          );
          return;
        }
    
        let sellingPropertyId =
          null;

        // SELLING PROPERTY
        if (selling) {
          const sellingPostcodeStored =
            formatUkPostcodeForStorage(selling.postcode);
          const { data: sellingCheck } = await supabase.rpc(
            "validate_onboarding_property_address",
            {
              p_address: selling.address,
              p_postcode: sellingPostcodeStored,
              p_chain_id: chainId,
            }
          );

          if (
            sellingCheck?.ok === false &&
            sellingCheck.error === "address_unavailable"
          ) {
            promptJoinExistingChain(
              chainId,
              {
                userId: user.id,
                address: selling.address,
                postcode: sellingPostcodeStored,
                onwardPurchase: buying
                  ? {
                      address: buying.address,
                      postcode: formatUkPostcodeForStorage(
                        buying.postcode
                      ),
                    }
                  : null,
              },
              false
            );
            return;
          }
    
          const sellingResult = await createStartMoveProperty(supabase, {
            chainId,
            relationshipType: "sale",
            address: selling.address,
            postcode: sellingPostcodeStored,
            awaitingBuyer: notBuying,
          });

          if (!sellingResult.ok) {
            await fail(
              "[start-move] sale property creation failed:",
              sellingResult.error,
              isAddressReservedFailure(sellingResult.error)
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE
            );
            return;
          }

          sellingPropertyId = sellingResult.propertyId;
          propertyEstablished = true;
    
        }
        let buyerReadyPropertyId: number | null = null;
        // BUYING PROPERTY
        if (buying) {
          const buyingPostcodeStored =
            formatUkPostcodeForStorage(buying.postcode);

          if (options.joinBuyingAfterSale) {
            redirected = true;
            redirectToJoinExistingChain(chainId, {
              carried: {
                userId: user.id,
                address: buying.address,
                postcode: buyingPostcodeStored,
              },
            });
            return;
          }

          const { data: buyingCheck } = await supabase.rpc(
            "validate_onboarding_property_address",
            {
              p_address: buying.address,
              p_postcode: buyingPostcodeStored,
              p_chain_id: chainId,
            }
          );

          if (
            buyingCheck?.ok === false &&
            buyingCheck.error === "address_unavailable"
          ) {
            promptJoinExistingChain(
              chainId,
              {
                userId: user.id,
                address: buying.address,
                postcode: buyingPostcodeStored,
              },
              propertyEstablished
            );
            return;
          }
    
          const buyingResult = await createStartMoveProperty(supabase, {
            chainId,
            relationshipType: "purchase",
            address: buying.address,
            postcode: buyingPostcodeStored,
            awaitingBuyer: false,
          });

          if (!buyingResult.ok) {
            const reserved = isAddressReservedFailure(buyingResult.error);
            await fail(
              "[start-move] purchase property creation failed:",
              buyingResult.error,
              reserved
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE,
              reserved ? "purchase_address_reserved" : "purchase_not_added"
            );
            return;
          }

          buyerReadyPropertyId = buyingResult.propertyId;
          propertyEstablished = true;

          if (sellingPropertyId != null) {
            const linkResult = await linkStartMoveOnwardPurchase(supabase, {
              salePropertyId: sellingPropertyId,
              purchasePropertyId: buyingResult.propertyId,
            });

            if (!linkResult.ok) {
              await fail(
                "[start-move] onward purchase link failed:",
                linkResult.error,
                START_MOVE_FAILED_MESSAGE,
                "purchase_not_linked"
              );
              return;
            }
          }
    
        }

        // SEARCHING PLACEHOLDER (stage-authoritative; no buying address)
        if (
          searchingForProperty &&
          !buying &&
          sellingPropertyId
        ) {
          const attachResult =
            await createSearchingPlaceholderForSale(
              supabase,
              {
                salePropertyId: sellingPropertyId,
              }
            );

          if (!attachResult.ok) {
            await fail(
              "[start-move] searching placeholder attach failed:",
              attachResult.error,
              START_MOVE_FAILED_MESSAGE,
              "searching_not_added"
            );
            return;
          }
        }

        if (notSelling && buyerReadyPropertyId != null) {
          const { error: buyerReadyError } = await supabase
            .from("chain_nodes")
            .insert({
              chain_id: chainId,
              linked_property_id: buyerReadyPropertyId,
              node_type: "buyer_ready",
              user_id: user.id,
              position: 0,
              stage: "mortgage_in_principle",
              status: "healthy",
              progress: 10,
              stage_entered_at: new Date().toISOString(),
            });

          // The purchase is already committed; chain cleanup here would delete it.
          if (buyerReadyError) {
            console.error(
              "[start-move] buyer ready create failed:",
              buyerReadyError.message
            );
            setRecovery({ chainId, reason: "buyer_ready_not_added" });
            return;
          }
        }
        redirected = true;
        window.location.href =
          `/chain/${chainId}?refresh=${Date.now()}`;
    
      } catch (error) {
        await fail(
          "[start-move] unexpected error:",
          error instanceof Error ? error.message : "unknown_error"
        );
      } finally {
        if (!redirected) {
          setIsSubmitting(false);
        }
      }
    
    }

  function renderStep() {
    switch (step) {
      case "selling":
        return (
          <YesNoQuestion
            question="Are you selling a property, or have you agreed the sale?"
            value={answers.selling}
            yesLabel="Yes, I'm selling a property"
            noLabel="No, I'm not selling"
            onAnswer={(value) => answerQuestion("selling", value)}
          />
        );
      case "saleAgreed":
        return (
          <YesNoQuestion
            question="Have you agreed the sale of your property?"
            hint="Your sale is agreed once you have accepted an offer from a buyer."
            value={answers.saleAgreed}
            yesLabel="Yes, my sale is agreed"
            noLabel="Not yet"
            onAnswer={(value) => answerQuestion("saleAgreed", value)}
          />
        );
      case "saleAddress":
        return (
          <AddressStep
            heading="What is the address of the property you are selling?"
            onContinue={() => continueFromAddressStep("saleAddress")}
          >
            <PropertyAddressLookup
              idPrefix="start-move-selling"
              label="Property address"
              address={sellingAddress}
              postcode={sellingPostcode}
              onAddressChange={setSellingAddress}
              onPostcodeChange={setSellingPostcode}
            />
          </AddressStep>
        );
      case "buying":
        return (
          <YesNoQuestion
            question="Are you / will you be buying a property?"
            value={answers.buying}
            yesLabel="Yes"
            noLabel="No"
            onAnswer={(value) => answerQuestion("buying", value)}
          />
        );
      case "offerAccepted":
        return (
          <YesNoQuestion
            question="Have you had an offer accepted?"
            hint="This is an offer you made on the property you are buying."
            value={answers.offerAccepted}
            yesLabel="Yes, my offer has been accepted"
            noLabel="Not yet"
            onAnswer={(value) => answerQuestion("offerAccepted", value)}
          />
        );
      case "purchaseAddress":
        return (
          <AddressStep
            heading="What is the address of the property you are buying?"
            onContinue={() => continueFromAddressStep("purchaseAddress")}
          >
            <PropertyAddressLookup
              idPrefix="start-move-buying"
              label="Property address"
              address={buyingAddress}
              postcode={buyingPostcode}
              onAddressChange={setBuyingAddress}
              onPostcodeChange={setBuyingPostcode}
            />
          </AddressStep>
        );
      case "review":
        return renderReview();
      case "stop_sale_not_agreed":
        return (
          <StopMessage title="It's a little early for MoveLoop">
            <p>
              MoveLoop helps you keep track of your property move once your
              sale has been agreed. If you&apos;re still preparing to sell or
              your property hasn&apos;t sold yet, there&apos;s nothing you
              need to add just now.
            </p>
            <p>
              Come back when your sale has been agreed, and we&apos;ll help
              you get your move connected.
            </p>
            <p className="font-semibold text-slate-900">
              Your move starts here when your sale is agreed.
            </p>
          </StopMessage>
        );
      case "stop_nothing_to_add":
        return (
          <StopMessage title="There's nothing to add yet">
            <p>
              MoveLoop keeps track of a property move once a sale has been
              agreed or an offer has been accepted on a property you are
              buying.
            </p>
            <p>
              As you&apos;re not selling or buying a property, there&apos;s
              no move to add just now. Nothing has been created.
            </p>
          </StopMessage>
        );
      case "stop_no_offer_accepted":
        return (
          <StopMessage title="It's a little early for MoveLoop">
            <p>
              MoveLoop helps you keep track of your property move once an
              offer has been accepted on the property you are buying. Until
              then, there&apos;s nothing you need to add.
            </p>
            <p>
              Come back when your offer has been accepted, and we&apos;ll help
              you get your move connected.
            </p>
          </StopMessage>
        );
      default:
        return null;
    }
  }

  function renderReview() {
    if (!moveFlags) {
      return null;
    }

    return (
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Check your details
        </h2>

        <dl className="mt-6 space-y-5 text-slate-700">
          <div>
            <dt className="text-sm font-medium text-slate-500">
              Your sale
            </dt>
            <dd className="mt-1">
              {selectedAddresses.selling ? (
                <AddressSummary value={selectedAddresses.selling} />
              ) : (
                "You are not selling a property."
              )}
            </dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-slate-500">
              Your purchase
            </dt>
            <dd className="mt-1 space-y-2">
              {selectedAddresses.buying ? (
                <AddressSummary value={selectedAddresses.buying} />
              ) : moveFlags.searchingForProperty ? (
                <>
                  <p className="font-medium text-slate-900">Searching</p>
                  <p>
                    Until you have an offer accepted, your next home will
                    show as Searching in your chain. You can add the property
                    from your chain once your offer is accepted.
                  </p>
                </>
              ) : (
                "You are not buying another property. Your chain will show your sale only."
              )}
              {moveFlags.notSelling ? (
                <p>
                  As you have nothing to sell, you&apos;ll be shown as a buyer
                  with no property to sell.
                </p>
              ) : null}
            </dd>
          </div>
        </dl>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-10 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Creating..." : "Create Chain"}
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "review") {
            void handleStartMove();
          }
        }}
        className="max-w-3xl mx-auto px-6 py-12"
      >

        <h1 className={PAGE_TITLE_CLASS}>
          Start Your Move
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Tell MoveLoop about your move — free for homeowners. You&apos;ll get a
          shared view of progress across connected parts of your chain as
          participants share updates.
        </p>

        <CollectionPointNotice
          className="mt-4"
          context="property-address"
        />

        <div className={`mt-12 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>
          {recovery != null ? (
            <StartMoveRecoveryPanel recovery={recovery} />
          ) : (
            <>
              <p
                className="text-sm font-medium text-slate-500"
                aria-live="polite"
              >
                Step {stepHistory.length} · {STEP_SECTION_LABEL[step]}
              </p>

              <div className="mt-4">{renderStep()}</div>

              {errorMessage ? (
                <div
                  role="alert"
                  className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <p>{errorMessage}</p>
                  <p className="mt-2">
                    Need help?{" "}
                    <HelpLink
                      section={HELP_SECTION_IDS.somethingWentWrong}
                      newTab
                      className="font-medium text-red-900 underline underline-offset-2 hover:text-red-950"
                    />
                  </p>
                </div>
              ) : null}

              {stepHistory.length > 1 ? (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={isSubmitting}
                  className="mt-8 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Back
                </button>
              ) : null}
            </>
          )}
        </div>

      </form>

      <DuplicatePropertyDialog
        isOpen={duplicateDialogOpen}
        isPending={isSubmitting}
        variant={duplicateDialogVariant}
        onJoinExisting={() => {
          const action = pendingDuplicateAction;

          if (action.kind === "open_chain") {
            window.location.href =
              action.chainId != null
                ? `/chain/${action.chainId}`
                : "/my-chains";
          } else if (action.kind === "join") {
            redirectToJoinExistingChain(null, {
              notSelling: action.notSelling,
              carried: action.carried,
            });
          } else if (action.kind === "join_source_chain") {
            redirectToJoinExistingChain(action.chainId, {
              carried: action.carried,
            });
          } else if (action.kind === "join_after_sale") {
            setDuplicateDialogOpen(false);
            setPendingDuplicateAction({ kind: "none" });
            void handleStartMove({ joinBuyingAfterSale: true });
          }
        }}
        onCancel={() => {
          const action = pendingDuplicateAction;

          setDuplicateDialogOpen(false);
          setPendingDuplicateAction({ kind: "none" });
          clearJoinAddressHandoff();

          if (action.kind === "join_source_chain") {
            if (action.preserveSourceChain) {
              setRecovery({
                chainId: action.chainId,
                reason: "purchase_already_on_moveloop",
              });
            } else {
              void cleanupOnboardingChain(action.chainId);
            }
          }
        }}
      />

    </main>
  );
}

function YesNoQuestion({
  question,
  hint,
  value,
  yesLabel,
  noLabel,
  onAnswer,
}: {
  question: string;
  hint?: string;
  value: YesNo | null;
  yesLabel: string;
  noLabel: string;
  onAnswer: (value: YesNo) => void;
}) {
  return (
    <fieldset>
      <legend className="text-2xl font-bold text-slate-900">
        {question}
      </legend>

      {hint ? (
        <p className="mt-2 text-slate-600">{hint}</p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <AnswerButton
          label={yesLabel}
          selected={value === "yes"}
          onClick={() => onAnswer("yes")}
        />
        <AnswerButton
          label={noLabel}
          selected={value === "no"}
          onClick={() => onAnswer("no")}
        />
      </div>
    </fieldset>
  );
}

function AnswerButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-left text-base font-semibold transition ${
        selected
          ? "border-brand-primary bg-brand-primary/10 text-slate-900"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function AddressStep({
  heading,
  onContinue,
  children,
}: {
  heading: string;
  onContinue: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900">{heading}</h2>

      <div className="mt-6">{children}</div>

      <button
        type="button"
        onClick={onContinue}
        className="mt-8 w-full bg-slate-900 text-white rounded-2xl py-4 text-lg font-semibold"
      >
        Continue
      </button>
    </div>
  );
}

function StopMessage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>

      <div className="mt-4 space-y-4 text-slate-700">{children}</div>

      <Link
        href="/dashboard"
        className="mt-8 inline-block text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
      >
        Go to your dashboard
      </Link>
    </div>
  );
}

function AddressSummary({
  value,
}: {
  value: { address: string; postcode: string };
}) {
  return (
    <>
      <p className="font-medium text-slate-900">{value.address}</p>
      <p>{formatUkPostcodeForStorage(value.postcode)}</p>
    </>
  );
}
