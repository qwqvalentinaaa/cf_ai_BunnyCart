import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';

export type RecommendationOutput = {
  topProducts: Product[];
  followUpQuestion: string;
}
type Env = {
  AI: Ai
	PRODUCT_RECOMMENDATION: Workflow;
};

type Product = {
  id: number;
  title: string;
  description: string;
  price: number;
  rating: number;
  brand?: string;
  category?: string;
  images?: string[];
  thumbnail?: string;
  reviews?: Array<{
    rating: number;
    comment: string;
  }>;
}
export type Params =   { 
    query: string,
    minPrice?: number,
    maxPrice?: number,
   };
export class ProductRecommendationWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const query = event.payload.query;

    // Fetch products
    const fetchedProducts = await step.do("fetch products", async () => {
      const response = await fetch(
        `https://dummyjson.com/products/search?q=${encodeURIComponent(query)}`
      );
      const data = await response.json<{ products: Product[] }>();
      return data.products;
    });

    // Filter products based on rating and price range
    const filteredProducts = await step.do("filter products based on rating and price range", async () => {
      const minPrice = event.payload.minPrice;
      const maxPrice = event.payload.maxPrice;

      return fetchedProducts.filter((p) => {
        const meetsMin = minPrice != null ? p.price >= minPrice : true;
        const meetsMax = maxPrice != null ? p.price <= maxPrice : true;
        return p.rating >= 2.0 && meetsMin && meetsMax;
      });
    });

    // LLM product ranking
    const top3 = await step.do("rank products with LLM", async () => {
      const prompt = `
          You are a shopping assistant. Rank the following products from best to worst for someone searching for: "${query}".

          Base the ranking on:
          - Rating
          - Price fairness
          - Reviews
          - Brand trust
          - Description relevance

          Return ONLY a JSON array of product IDs sorted best → worst.

          Products:
          ${JSON.stringify(filteredProducts, null, 2)}
      `;

      const result = await this.env.AI.run("@cf/meta/llama-3.1-70b-instruct" as any, { prompt });

      const rankedIds: number[] = JSON.parse(result.response || "[]");

      return rankedIds
        .map((id) => filteredProducts.find((p) => p.id === id))
        .filter(Boolean)
        .slice(0, 3);
    });

    return {
      topProducts: top3,
      followUpQuestion:
        "Do you want me to highlight the pros and cons of these top 3 products?",
    } as RecommendationOutput;
  }
}
