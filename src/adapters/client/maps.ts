/** Browser-safe Maps configuration. Restrict this key by HTTP referrer in Google Cloud. */
export const googleMapsBrowserConfig = {
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
} as const;

export interface GoogleMapsPoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}
