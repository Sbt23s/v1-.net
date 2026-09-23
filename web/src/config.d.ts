declare module "@/config" {
  interface Config {
    API_BASE_URL: string;
  }
  const config: Config;
  export default config;
}
