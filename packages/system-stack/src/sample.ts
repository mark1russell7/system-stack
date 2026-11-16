import { STACK_SCHEMA, type Stack } from "./stack.ts";

/**
 * A sample stack: an alert gets to its reader through one of two copies of a program and one of two message services.
 * Each name is an example. The tests, the README files and the site use it.
 */
export const SAMPLE_STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "reader", kind: "person", name: "The reader of the alerts" },
    { id: "phone", kind: "device", name: "The phone of the reader", owner: "reader" },
    { id: "card", kind: "card", name: "The payment card", owner: "reader" },
    { id: "home-power", kind: "power", name: "The power of the home" },
    { id: "home-network", kind: "network", name: "The network of the home", needs: ["home-power"] },
    { id: "home-host", kind: "host", name: "The computer at home", needs: ["home-power", "home-network"], owner: "reader" },
    { id: "cloud-account", kind: "account", name: "The account of the cloud provider", needs: ["card"], owner: "reader" },
    { id: "cloud-host", kind: "host", name: "The cloud server", needs: ["cloud-account"] },
    { id: "program-home", kind: "service", name: "The alert program at home", needs: ["home-host"] },
    { id: "program-cloud", kind: "service", name: "The alert program in the cloud", needs: ["cloud-host"] },
    { id: "push-account", kind: "account", name: "The account of the push service", owner: "reader" },
    { id: "push", kind: "service", name: "The push service", needs: ["push-account"] },
    { id: "call-account", kind: "account", name: "The account of the call service", needs: ["card"], owner: "reader" },
    { id: "call", kind: "service", name: "The call service", needs: ["call-account"] },
    {
      id: "alert",
      kind: "function",
      name: "An alert gets to its reader",
      needs: [{ any: ["program-home", "program-cloud"] }, { any: ["push", "call"] }, "phone", "reader"],
    },
  ],
};
