import {
  coworkDigest,
  coworkItemReceiptSchema,
} from "./CoworkFactoryContract.js";
import type { CoworkItemHost } from "./CoworkFactory.js";

export interface CoworkNativeItemTransport {
  request(
    request: {
      readonly provider: "github" | "azure-devops";
      readonly method: "POST" | "PATCH";
      readonly url: string;
      readonly contentType: "application/json" | "application/json-patch+json";
      readonly body: unknown;
      readonly intent: string;
    },
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Credentials remain in the trusted transport; native JSON is not model input. */
export function createCoworkNativeItemHost(
  options: Pick<
    CoworkItemHost,
    "authorize" | "verifyEvidence" | "audit" | "verifyReceipt"
  > & {
    readonly transport: CoworkNativeItemTransport;
    readonly githubApiUrl?: string;
    readonly githubWebUrl?: string;
  },
): CoworkItemHost {
  const api = new URL(options.githubApiUrl ?? "https://api.github.com");
  const web = new URL(options.githubWebUrl ?? "https://github.com");
  if (
    [api, web].some(
      (url) =>
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash,
    )
  )
    throw new Error("Credential-free HTTPS GitHub hosts required");
  return {
    authorize: options.authorize,
    verifyEvidence: options.verifyEvidence,
    audit: options.audit,
    verifyReceipt: options.verifyReceipt,
    async create(item, intent, signal) {
      const target =
        item.provider === "github"
          ? { provider: item.provider, repository: item.repository }
          : {
              provider: item.provider,
              organization: item.organization,
              project: item.project,
              workItemType: item.workItemType,
            };
      const reply = await options.transport.request(
        item.provider === "github"
          ? {
              provider: item.provider,
              method: "POST",
              url: `${api.href.replace(/\/$/, "")}/repos/${item.repository}/issues`,
              contentType: "application/json",
              body: { title: item.title, body: item.body },
              intent,
            }
          : {
              provider: item.provider,
              method: "PATCH",
              url: `https://dev.azure.com/${encodeURIComponent(item.organization)}/${encodeURIComponent(item.project)}/_apis/wit/workitems/$${encodeURIComponent(item.workItemType)}?api-version=7.1`,
              contentType: "application/json-patch+json",
              body: Object.entries(item.fields).map(([field, value]) => ({
                op: "add",
                path: `/fields/${field}`,
                value,
              })),
              intent,
            },
        signal,
      );
      if (!reply || typeof reply !== "object") return { state: "unknown" };
      const value = reply as Record<string, unknown>;
      const id = item.provider === "github" ? value.number : value.id;
      if (!Number.isSafeInteger(id) || (id as number) <= 0)
        return { state: "unknown" };
      const expectedUrl =
        item.provider === "github"
          ? `${web.href.replace(/\/$/, "")}/${item.repository}/issues/${id}`
          : `https://dev.azure.com/${encodeURIComponent(item.organization)}/${encodeURIComponent(item.project)}/_workitems/edit/${id}`;
      const nativeUrl =
        item.provider === "github" ? value.html_url : expectedUrl;
      if (nativeUrl !== expectedUrl) return { state: "unknown" };
      const receipt = coworkItemReceiptSchema.parse({
        id: String(id),
        url: expectedUrl,
        intent,
        targetDigest: coworkDigest(target),
      });
      return { state: "completed", receipt };
    },
  };
}
