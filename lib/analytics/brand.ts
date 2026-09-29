/** Devuelve la marca temporal mientras el modelo de marcas del proyecto llega. */
export function getBrandForRestaurant(restaurant: { name: string }): string {
  // TODO: usar restaurants.brand_id cuando Carlos agregue la tabla brands.
  return restaurant.name;
}
