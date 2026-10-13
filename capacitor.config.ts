import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "cn.tc.assistant",
  appName: "L-BOT",
  webDir: "dist",
  loggingBehavior: "none",
  android: {
    path: "apps/android",
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: { androidScheme: "https" },
};
export default config;
