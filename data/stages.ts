export const STAGES = [

  {
    value: "searching",
    label: "Next Home Search",
    progress: 0,
    nextStep: "Offer Accepted",
    expectedTimeframe: "Variable",
  },

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
    progress: 12,
    nextStep: "Solicitors Instructed",
    expectedTimeframe: "1–7 days",
  },

  {
    value: "solicitors_instructed",
    label: "Solicitors Instructed",
    progress: 20,
    nextStep: "Searches Ordered",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "searches_ordered",
    label: "Searches Ordered",
    progress: 30,
    nextStep: "Survey Booked",
    expectedTimeframe: "1–3 weeks",
  },

  {
    value: "survey_booked",
    label: "Survey Booked",
    progress: 40,
    nextStep: "Searches Returned",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "searches_returned",
    label: "Searches Returned",
    progress: 50,
    nextStep: "Survey Completed",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "survey_completed",
    label: "Survey Completed",
    progress: 60,
    nextStep: "Mortgage Offer Received",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "mortgage_offer_received",
    label: "Mortgage Offer Received",
    progress: 70,
    nextStep: "Enquiries Raised",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "enquiries_raised",
    label: "Enquiries Raised",
    progress: 78,
    nextStep: "Enquiries Fully Answered",
    expectedTimeframe: "1–4 weeks",
  },

  {
    value: "enquiries_fully_answered",
    label: "Enquiries Fully Answered",
    progress: 85,
    nextStep: "Contracts Issued",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "contracts_issued",
    label: "Contracts Issued",
    progress: 90,
    nextStep: "Ready To Exchange",
    expectedTimeframe: "1–2 weeks",
  },

  {
    value: "ready_to_exchange",
    label: "Ready To Exchange",
    progress: 95,
    nextStep: "Contracts Exchanged",
    expectedTimeframe: "1–7 days",
  },

  {
    value: "contracts_exchanged",
    label: "Contracts Exchanged",
    progress: 98,
    nextStep: "Completion Date Agreed",
    expectedTimeframe: "1–4 weeks",
  },

  {
    value: "completion_date_agreed",
    label: "Completion Date Agreed",
    progress: 99,
    nextStep: "Completed",
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