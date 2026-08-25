export type LegalDocumentSection = {
  id?: string;
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
};

export type LegalDocumentContent = {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  sections: readonly LegalDocumentSection[];
};
