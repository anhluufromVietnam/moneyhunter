const { server } = require('./lib/router');
const { sign } = require('./lib/auth');
const PORT = process.env.PORT || 8787;
if (require.main === module) {
  server.listen(PORT, () => {
    const jwt = sign({ scope: 'admin', sub: 'admin' });
    console.log(`\nWheel Provider v2 on http://localhost:${PORT}`);
    console.log(`Demo page:      http://localhost:${PORT}/demo`);
    console.log(`Entry example:  http://localhost:${PORT}/entry?userId=USR_001&token=${jwt}`);
    console.log(`Admin JWT:      ${jwt}`);
    console.log(`Trigger header: X-Client-Id: mygreen / X-Api-Key: ${process.env.MYGREEN_API_KEY || 'mygreen_api_key_test'}\n`);
  });
}
module.exports = { server };
