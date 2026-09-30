export type AnalyticsBrand = {
  id: string;
  name: string;
  accentColor: string;
};

/** Devuelve la marca asociada por restaurants.brand_id, si sigue existiendo. */
export function getBrandForRestaurant(restaurant: {
  brandId: string | null;
  brand: AnalyticsBrand | null;
}): AnalyticsBrand | null {
  return restaurant.brandId && restaurant.brand?.id === restaurant.brandId
    ? restaurant.brand
    : null;
}
