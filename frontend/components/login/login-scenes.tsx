"use client";

import dynamic from "next/dynamic";

// The animated layers are not needed to sign in: their code is fetched after the form is on screen, and only in the browser.
const MoleculeField = dynamic(() => import("@/components/login/molecule-field").then((m) => m.MoleculeField), { ssr: false });
const ProductionLine = dynamic(() => import("@/components/login/production-line").then((m) => m.ProductionLine), { ssr: false });

export function LoginScenes() {
  return (
    <>
      <MoleculeField />
      <ProductionLine />
    </>
  );
}
