export type BrandThemeId = "keynetic" | "teal-mimosa" | "butter-green";

export type BrandThemeDefinition = {
  id: BrandThemeId;
  label: string;
  description: string;
  primary: string;
  secondary: string;
};
