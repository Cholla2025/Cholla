// Azure Functions v4 entry point — registering a require here is all it takes
// for each handler's app.http() call to run at host startup.

require('./functions/health')
require('./functions/kiosk')
require('./functions/org')
require('./functions/rosters')
