import type { Metadata } from "next";

import { HomeAddressForm } from "@/components/HomeAddressForm";

export const metadata: Metadata = {
  title: "Home address | ECNL",
  description: "A home address saved on the account. It is not public.",
};

export default function AddressPage() {
  return <HomeAddressForm />;
}
