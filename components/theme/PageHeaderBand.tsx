import { PAGE_HEADER_BAND_CLASS } from "@/lib/theme/themeTokens";

/** Themed identity strip shown below navigation on product pages. */
export default function PageHeaderBand() {
  return (
    <div
      className={PAGE_HEADER_BAND_CLASS}
      aria-hidden="true"
    />
  );
}
