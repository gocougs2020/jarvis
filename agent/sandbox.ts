import { defaultBackend, defineSandbox } from "eve/sandbox";
import type { CustomCommand } from "just-bash";
import { appConfig } from "../app.config";

// Egress is set on the backend factory (not in onSession) so it also holds
// after a provider-loss replacement. See app.config.ts `security.sandboxNetwork`.
type SandboxNetwork = "deny-all" | "allow-all" | readonly string[];
// Widened so a fork can change the config value without type errors here.
const network = appConfig.security.sandboxNetwork as SandboxNetwork;
const networkPolicy =
  typeof network === "string" ? network : { allow: [...network] };
const dockerNetworkPolicy = typeof network === "string" ? network : "deny-all";

// The just-bash fallback (local hosts with neither Docker nor microsandbox)
// always gives its `curl` full internet access and has no network policy, so
// replace the network commands unless egress is fully open. Plain objects and
// a type-only import: just-bash is a dev dependency and may be absent at runtime.
const blockedNetworkCommands: CustomCommand[] | undefined =
  network === "allow-all"
    ? undefined
    : ["curl", "wget"].map((name) => ({
        name,
        execute: async () => ({
          stdout: "",
          stderr: `${name}: outbound network is disabled for this sandbox (security.sandboxNetwork in app.config.ts).\n`,
          exitCode: 1,
        }),
      }));

export default defineSandbox({
  backend: defaultBackend({
    vercel: { networkPolicy },
    microsandbox: { networkPolicy },
    docker: { networkPolicy: dockerNetworkPolicy },
    ...(blockedNetworkCommands ? { justBash: { customCommands: blockedNetworkCommands } } : {}),
  }),
});
