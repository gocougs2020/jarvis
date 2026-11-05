import { defaultBackend, defineSandbox } from "eve/sandbox";
import { appConfig } from "../app.config";

// Egress is set on the backend factory (not in onSession) so it also holds
// after a provider-loss replacement. See app.config.ts `security.sandboxNetwork`.
const network: "deny-all" | "allow-all" | readonly string[] = appConfig.security.sandboxNetwork;
const networkPolicy =
  typeof network === "string" ? network : { allow: [...network] };
const dockerNetworkPolicy = typeof network === "string" ? network : "deny-all";

export default defineSandbox({
  backend: defaultBackend({
    vercel: { networkPolicy },
    microsandbox: { networkPolicy },
    docker: { networkPolicy: dockerNetworkPolicy },
  }),
});
