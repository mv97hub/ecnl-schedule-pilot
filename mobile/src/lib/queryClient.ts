import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * MINUTE,
      gcTime: 7 * DAY,
      networkMode: "offlineFirst",
      retry: 1,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "soccer-away-day-cache",
});

export const QUERY_MAX_AGE = 7 * DAY;
