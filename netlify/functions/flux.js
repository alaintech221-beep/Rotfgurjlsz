const SOURCES = {
  france4: "https://sv1.data-stream.top/hls/france4.m3u8",
};

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id;
  const targetUrl = SOURCES[id];

  if (!targetUrl) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ erreur: "Chaîne inconnue : " + id })
    };
  }

  return {
    statusCode: 302,
    headers: {
      "Location": targetUrl,
      "Cache-Control": "no-store"
    },
    body: ""
  };
};
