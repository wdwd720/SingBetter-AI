import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

export function useLocale() {
  const query = useQuery<{ settings?: { locale?: string } }>({
    queryKey: ["/api/profile", "locale"],
    queryFn: async () => {
      const response = await fetch("/api/profile", { credentials: "include" });
      if (!response.ok) return {};
      return response.json();
    },
    retry: false,
  });

  useEffect(() => {
    const locale = query.data?.settings?.locale || "en";
    document.documentElement.lang = locale;
  }, [query.data?.settings?.locale]);

  return query.data?.settings?.locale || "en";
}
