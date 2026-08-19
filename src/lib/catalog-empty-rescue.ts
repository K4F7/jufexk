/** Gate for hinting at the opposite catalog when this one is empty. */

export function shouldOfferCatalogRescue({
  itemCount,
  query,
  extraFilters = false,
}: {
  itemCount: number;
  query: string;
  extraFilters?: boolean;
}): boolean {
  return itemCount === 0 && query.trim().length > 0 && !extraFilters;
}
