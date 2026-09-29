import { use } from "react";
import { RestaurantNav } from "@/components/restaurant-nav";

export default function RestauranteLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = use(params);
  return (
    <div>
      <RestaurantNav restaurantId={id} />
      {children}
    </div>
  );
}
