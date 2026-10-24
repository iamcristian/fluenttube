import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: (failureCount) => {
        // Do not auto-retry on multiple failures
        if (failureCount >= 2) return false;
        return true;
      },
      refetchOnWindowFocus: false,
    },
  },
});
