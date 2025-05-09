export const mockRequestDiscordWebhook =
  async (item: { title: string; linkHash: string }) => () => {
    const res = new Response(JSON.stringify({ test: true }));
    console.log(`Sending message to Discord: ${item.title} - ${item.linkHash}`);
    return res;
  };
