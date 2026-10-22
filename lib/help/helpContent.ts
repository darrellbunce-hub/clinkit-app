import { ROUTES } from "@/lib/auth/routes";
import {
  LEGAL_ROUTES,
  PRIVACY_EMAIL,
  PRIVACY_MAILTO,
} from "@/lib/legal/constants";

export const HELP_SECTION_IDS = {
  aboutMoveLoop: "about-moveloop",
  startingOrJoining: "starting-or-joining",
  accessCodes: "access-codes",
  statuses: "statuses",
  alreadyOnMoveLoop: "already-on-moveloop",
  somethingWentWrong: "something-went-wrong",
  privacyAndVisibility: "privacy-and-visibility",
  gettingHelp: "getting-help",
} as const;

export type HelpSectionId =
  (typeof HELP_SECTION_IDS)[keyof typeof HELP_SECTION_IDS];

export function helpHref(section?: HelpSectionId): string {
  return section ? `${ROUTES.help}#${section}` : ROUTES.help;
}

export type HelpLink = {
  href: string;
  label: string;
};

export type HelpFaqItem = {
  id: string;
  question: string;
  answer: readonly string[];
  links?: readonly HelpLink[];
};

export type HelpSection = {
  id: HelpSectionId;
  title: string;
  items: readonly HelpFaqItem[];
};

export const HELP_STATUS_LABELS: ReadonlyArray<{
  label: string;
  meaning: string;
}> = [
  {
    label: "Your Sale / Your Purchase",
    meaning:
      "The property you are selling or buying. Labels are shown relative to you, so other participants may see the same property under a different label.",
  },
  {
    label: "Connected Buyer / Connected Purchase",
    meaning:
      "Another participant's position that is connected to yours in the chain.",
  },
  {
    label: "Awaiting Buyer",
    meaning: "A sale that has not yet connected to a buyer on MoveLoop.",
  },
  {
    label: "Searching / Next Home Search",
    meaning:
      "The seller intends to buy but has not yet had an offer accepted on their next home. When they have, the property they are buying replaces it. Another participant's search is shown as Seller's Next Home Search.",
  },
  {
    label: "Buyer Ready",
    meaning:
      "A buyer who has no property to sell. It appears once, at the buyer's end of the chain, against the property they are buying.",
  },
  {
    label: "Connected",
    meaning: "The property is connected to the chain on MoveLoop.",
  },
  {
    label: "Pending Connection",
    meaning:
      "The property is part of the chain but is still waiting for another participant to connect.",
  },
  {
    label: "Disconnected",
    meaning: "A connection that previously existed has been broken.",
  },
  {
    label: "Delayed",
    meaning:
      "The property has been marked as delayed. Delays reported through a property update are shown on the property itself and do not change this label.",
  },
];

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: HELP_SECTION_IDS.aboutMoveLoop,
    title: "About MoveLoop",
    items: [
      {
        id: "what-is-moveloop",
        question: "What does MoveLoop do?",
        answer: [
          "MoveLoop gives the people involved in a property chain a shared view of how the chain is progressing. Homeowners, buyers, sellers and estate agents can see progress, milestones and where attention may be needed across the connected parts of the chain.",
          "MoveLoop is a coordination tool. It does not provide legal advice, independently verify progress, or guarantee that a chain will complete or complete on a particular date.",
        ],
      },
      {
        id: "alongside-estate-agent-systems",
        question: "How does MoveLoop work alongside estate agents' systems?",
        answer: [
          "Estate agents use MoveLoop alongside their existing CRM systems. It does not replace them. MoveLoop provides one shared chain view that participants from different firms can see.",
          "An estate agent can add a property for a sale they represent and invite the homeowner to connect. Representing a sale does not make the estate agent its owner, and an estate agent can only act on the properties they are authorised to represent.",
        ],
        links: [
          {
            href: ROUTES.estateAgentMarketing,
            label: "MoveLoop for estate agents",
          },
        ],
      },
      {
        id: "is-it-free",
        question: "Is MoveLoop free for homeowners?",
        answer: ["Yes. Homeowners can use MoveLoop at no cost."],
      },
      {
        id: "whole-chain-connected",
        question: "Does the whole chain need to be on MoveLoop?",
        answer: [
          "No. A chain can be partially connected. MoveLoop only shows updates for the properties and participants connected to it, and the view improves as more of the chain connects.",
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.startingOrJoining,
    title: "Starting or joining a chain",
    items: [
      {
        id: "start-or-join",
        question: "Should I start a move or join an existing chain?",
        answer: [
          "Join an existing chain if you have been given a chain access code for your property. Joining connects your property to the chain that already exists, rather than creating a separate one.",
          "Start your move if you are adding your own sale, purchase or both and you have not been given an access code.",
        ],
        links: [
          { href: "/join-chain", label: "Join an existing chain" },
          { href: "/start-move", label: "Start your move" },
        ],
      },
      {
        id: "before-you-start",
        question: "What do I need before I start my move?",
        answer: [
          "If you are selling, your sale must be agreed, meaning you have accepted an offer from a buyer. If it has not been agreed yet, it is too early to add your move.",
          "If you are buying and your offer has been accepted, you can add the address of the property you are buying. If you intend to buy but have not had an offer accepted yet, your next home is shown as Searching.",
          "If you are not selling and have not had an offer accepted on a purchase, there is nothing to add yet.",
        ],
      },
      {
        id: "how-joining-works",
        question: "What happens when I join a chain?",
        answer: [
          "You enter the chain access code together with your property's address and postcode. MoveLoop checks these details together before connecting you.",
          "Once you are connected, you see the chain from your own position in it.",
        ],
      },
      {
        id: "adding-purchase-later",
        question: "Can I add the property I am buying later?",
        answer: [
          "If your next home is shown as Searching, you can add the property you are buying from your chain once your offer has been accepted.",
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.accessCodes,
    title: "Access codes",
    items: [
      {
        id: "what-is-access-code",
        question: "What is a chain access code?",
        answer: [
          "A chain access code lets you connect your property to an existing chain on MoveLoop. It is always used together with the property's address and postcode.",
          "People who are already connected to a chain can see its access code on the chain page. If you have been asked to join a chain, ask the person or estate agent who invited you for the code.",
        ],
      },
      {
        id: "what-access-code-does-not-do",
        question: "What does an access code not allow?",
        answer: [
          "An access code is not proof that you own a property. It does not give you access to every property in the chain, and it does not give you permission to update or manage anyone else's property.",
          "Knowing an access code, address and postcode is not enough, on its own, for an estate agent to represent a seller.",
        ],
      },
      {
        id: "access-code-not-accepted",
        question: "My access code was not accepted. What should I do?",
        answer: [
          "Check that the access code, address and postcode are exactly as given to you for that property, then try again. For security, MoveLoop does not say which detail did not match, and repeated attempts may be temporarily limited.",
          "If it still does not work, ask the person or estate agent who gave you the code to confirm the details.",
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.statuses,
    title: "What the labels in your chain mean",
    items: [
      {
        id: "relative-labels",
        question: "Why does my chain look different to someone else's?",
        answer: [
          "Everyone connected to a chain sees the same chain, but each person sees it from their own position. Labels such as Your Sale and Connected Buyer describe properties in relation to you.",
        ],
      },
      {
        id: "searching-vs-awaiting-buyer",
        question: "What is the difference between Searching and Awaiting Buyer?",
        answer: [
          "Awaiting Buyer means a sale has not yet connected to a buyer. Searching means the seller intends to buy but has not yet identified the property they are buying. They are separate states.",
          "MoveLoop does not show a purchase you have already agreed as Searching just because a setup step did not finish.",
        ],
      },
      {
        id: "labels-do-not-guarantee",
        question: "Does a status mean my move will complete?",
        answer: [
          "No. Labels show what has been shared on MoveLoop. They do not guarantee that a chain will complete or that it will complete on a particular date.",
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.alreadyOnMoveLoop,
    title: "When a sale or purchase is already on MoveLoop",
    items: [
      {
        id: "already-part-of-moveloop",
        question: "MoveLoop says my property is already on MoveLoop. Why?",
        answer: [
          "Someone else may have added it already. For example, the buyer of your home may have added it to their chain as the property they are buying. Each property can only appear once, so MoveLoop does not create a duplicate.",
          "Instead, join the existing chain using the chain access code you were given for that property.",
        ],
        links: [{ href: "/join-chain", label: "Join an existing chain" }],
      },
      {
        id: "already-connected-elsewhere",
        question: "MoveLoop says my property is already connected in another chain.",
        answer: [
          "The property is already represented, so it cannot be added again. If your estate agent invited you, use the link in your invitation to connect.",
        ],
      },
      {
        id: "property-before-owner-joins",
        question: "How is a property shown before its owner joins?",
        answer: [
          "A property can be part of a chain before its homeowner or estate agent connects. It keeps its position in the chain while it waits.",
          "Adding a property in this way does not make the person who added it its owner, and it does not give them permission to manage it.",
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.somethingWentWrong,
    title: "If something goes wrong",
    items: [
      {
        id: "setup-step-did-not-finish",
        question: "My chain was created, but a step did not finish.",
        answer: [
          "The parts of your move that were saved are kept. Open your chain to check what is there before doing anything else.",
          "Please do not start a new move for the same property. Starting again with the same address will point you back to your existing chain.",
        ],
        links: [{ href: "/my-chains", label: "Open my chains" }],
      },
      {
        id: "could-not-create-chain",
        question: "I saw “We could not create your chain”.",
        answer: [
          "Your chain was not created. Check your details and try again. If the same message appears again, wait a few minutes before trying again.",
        ],
      },
      {
        id: "purchase-not-added",
        question: "My sale was added, but the property I am buying was not.",
        answer: [
          "Your sale is kept. Open your chain to check it. MoveLoop does not show a purchase you have already agreed as Searching just because it could not be added.",
          "If the property you are buying is already on MoveLoop, it cannot be added to your chain again.",
        ],
        links: [{ href: "/my-chains", label: "Open my chains" }],
      },
      {
        id: "join-did-not-finish",
        question: "I joined a chain, but a later step did not finish.",
        answer: [
          "A successful join is kept. Open your dashboard to check your chain before trying again, and do not join the same chain again with the same code.",
        ],
        links: [{ href: ROUTES.homeownerDashboard, label: "Go to your dashboard" }],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.privacyAndVisibility,
    title: "Privacy and what others can see",
    items: [
      {
        id: "who-can-see-chain",
        question: "Who can see my chain?",
        answer: [
          "Information about a chain is visible to participants who are entitled to access it. Access is controlled by participation in the chain and, where relevant, estate agent assignment.",
          "Having a MoveLoop account does not give anyone access to other chains.",
        ],
      },
      {
        id: "address-visibility",
        question: "Can other participants see my address?",
        answer: [
          "Your address is shown only to people connected to that property, such as your buyer (for whom it is the property they are buying) and an estate agent representing it. Elsewhere in the chain, properties are shown by their position rather than their address.",
          "MoveLoop does not show other participants your email address, and it does not show you which estate agent represents another property in the chain.",
        ],
      },
      {
        id: "who-can-update",
        question: "Can other people change my property's details?",
        answer: [
          "No. Being able to see a property in the chain does not give permission to update it. If you have appointed an estate agent, you control whether they can make updates on your behalf.",
        ],
      },
      {
        id: "privacy-requests",
        question: "How do I make a privacy or data-protection request?",
        answer: [
          `Read our Privacy Policy for your rights and how we handle personal information. For privacy and data-protection questions or requests, email ${PRIVACY_EMAIL}.`,
          "This address is for privacy and data-protection matters only.",
        ],
        links: [
          { href: LEGAL_ROUTES.privacy, label: "Privacy Policy" },
          { href: PRIVACY_MAILTO, label: PRIVACY_EMAIL },
        ],
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.gettingHelp,
    title: "Your estate agent, conveyancer and MoveLoop",
    items: [
      {
        id: "who-to-contact",
        question:
          "When should I contact my estate agent or conveyancer rather than MoveLoop?",
        answer: [
          "Contact your estate agent or conveyancer about the transaction itself: offers, negotiations, surveys, searches, mortgage, contracts, exchange, completion dates and legal advice.",
          "MoveLoop shows shared progress across the chain. It does not run your transaction, give legal advice or replace your estate agent or conveyancer.",
        ],
      },
    ],
  },
];
