import { getResults, transformResultData } from "@/lib/strapi";
import ResultsClient from "./ResultsClient";

export const metadata = {
  title: "Research Results",
  description: "Research outputs, datasets, code repositories, and other deliverables from our projects.",
};

export default async function ResultsPage() {
  const strapiResults = await getResults();
  const results = transformResultData(strapiResults);

  return <ResultsClient results={results} />;
}
