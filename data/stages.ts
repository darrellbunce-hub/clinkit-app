export const STAGES = [

  {
    value: "property_listed",
    label: "Property Listed",
    progress: 5,
    nextStep: "Offer Accepted",
    expectedTimeframe: "1–12 weeks",
  },

  {
    value: "offer_accepted",
    label: "Offer Accepted",
    progress: 15,
    nextStep: "Solicitors Instructed",
    expectedTimeframe: "1–7 days",
  },

  {
    value: "solicitors_instructed",
    label: "Solicitors Instructed",
    progress: 25,
    nextStep: "Searches Ordered",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "searches_ordered",
    label: "Searches Ordered",
    progress: 40,
    nextStep: "Searches Returned",
    expectedTimeframe: "1–3 weeks",
  },

  {
    value: "searches_returned",
    label: "Searches Returned",
    progress: 55,
    nextStep: "Mortgage Offer Received",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "mortgage_offer_received",
    label: "Mortgage Offer Received",
    progress: 65,
    nextStep: "Contracts Issued",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "contracts_issued",
    label: "Contracts Issued",
    progress: 75,
    nextStep: "Exchange Contracts",
    expectedTimeframe: "1–3 weeks",
  },

  {
    value: "exchange_contracts",
    label: "Exchange Contracts",
    progress: 90,
    nextStep: "Completion",
    expectedTimeframe: "1–4 weeks",
  },

  {
    value: "completed",
    label: "Completed",
    progress: 100,
    nextStep: "Move In",
    expectedTimeframe: "Complete",
  },

];