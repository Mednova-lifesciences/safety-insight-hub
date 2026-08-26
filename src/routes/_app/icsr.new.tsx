import { createFileRoute } from "@tanstack/react-router";
import { IcsrIntakeForm } from "@/components/pv/icsr-intake-form";

export const Route = createFileRoute("/_app/icsr/new")({
  head: () => ({
    meta: [
      { title: "New ICSR — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Capture a new individual case safety report with the minimum criteria required for a valid ICSR.",
      },
      { property: "og:title", content: "New ICSR — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Structured ICSR intake with validation, triage and coding hand-off.",
      },
    ],
  }),
  component: NewIcsrPage,
});

function NewIcsrPage() {
  return <IcsrIntakeForm />;
}
