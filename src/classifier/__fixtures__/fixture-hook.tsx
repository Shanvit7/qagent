import { useState, useEffect } from "react";

export const useUserData = (userId: string) => {
  const [data, setData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/users/${userId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) {
          setData(json.name);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [userId]);

  return { data, loading };
};
