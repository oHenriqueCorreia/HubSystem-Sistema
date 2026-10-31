type LeadLocation = {
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  place_id: string | null;
  gmb_url: string | null;
};

/** Open the imported Maps listing when trusted; otherwise search its saved location. */
export function leadMapsUrl(lead: LeadLocation): string {
  if (lead.gmb_url) {
    try {
      const url = new URL(lead.gmb_url);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol === "https:" &&
        (host === "maps.app.goo.gl" || host === "maps.google.com" || ((host === "google.com" || host === "www.google.com") && url.pathname.startsWith("/maps")))
      ) {
        return url.toString();
      }
    } catch {
      // Imported links may be incomplete; the search below still works.
    }
  }

  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", [lead.name, lead.address, lead.neighborhood, lead.city, lead.state].filter(Boolean).join(", "));
  if (lead.place_id) url.searchParams.set("query_place_id", lead.place_id);
  return url.toString();
}
