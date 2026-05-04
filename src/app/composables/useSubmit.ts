import type {
  NitroFetchRequest,
  NitroFetchOptions,
  TypedInternalResponse,
  ExtractedRouteMethod,
} from 'nitropack/types';
import { FetchError } from 'ofetch';

type RevertFn<
  R extends NitroFetchRequest,
  T = unknown,
  O extends NitroFetchOptions<R> = NitroFetchOptions<R>,
> = (
  success: boolean,
  data:
    | TypedInternalResponse<
        R,
        T,
        NitroFetchOptions<R> extends O ? 'get' : ExtractedRouteMethod<R, O>
      >
    | undefined
) => Promise<void>;

type SubmitOpts<
  R extends NitroFetchRequest,
  T = unknown,
  O extends NitroFetchOptions<R> = NitroFetchOptions<R>,
> = {
  revert: RevertFn<R, T, O>;
  successMsg?: string;
  noSuccessToast?: boolean;
};

function getFriendlyErrorMessage(e: FetchError): string {
  const status = e.statusCode;
  const dataMessage = e.data?.message;

  if (status === 403) {
    return dataMessage || 'You do not have permission to perform this action.';
  }
  if (status === 500) {
    return dataMessage || 'A server error occurred. Please try again later.';
  }
  if (status === 401) {
    return dataMessage || 'Your session has expired. Please log in again.';
  }
  if (status === 404) {
    return dataMessage || 'The requested resource was not found.';
  }
  if (status === 429) {
    return dataMessage || 'Too many requests. Please wait a moment.';
  }
  return dataMessage || e.message || 'An unexpected error occurred.';
}

export function useSubmit<
  R extends NitroFetchRequest,
  O extends NitroFetchOptions<R> & { body?: never },
  T = unknown,
>(url: R, options: O, opts: SubmitOpts<R, T, O>) {
  const toast = useToast();

  return async (data: unknown) => {
    try {
      const res = await $fetch(url, {
        ...options,
        body: data,
      });

      if (!opts.noSuccessToast) {
        toast.showToast({
          type: 'success',
          message: opts.successMsg,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await opts.revert(true, res as any);
    } catch (e) {
      if (e instanceof FetchError) {
        toast.showToast({
          type: 'error',
          message: getFriendlyErrorMessage(e),
        });
      } else if (e instanceof Error) {
        toast.showToast({
          type: 'error',
          message: e.message,
        });
      } else {
        console.error(e);
      }
      await opts.revert(false, undefined);
    }
  };
}
