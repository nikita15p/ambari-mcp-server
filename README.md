# Ambari MCP Server

A Model Context Protocol (MCP) server for Apache Ambari, built with the TypeScript SDK. This server provides tools to interact with Ambari clusters through the MCP protocol.

## Overview

This MCP server allows AI assistants and other MCP clients to interact with Apache Ambari clusters by exposing common Ambari REST API operations as MCP tools.

## Features

- **Cluster Management**: Get cluster information, create clusters
- **Service Management**: List and get details of cluster services
- **Host Management**: List and get details of cluster hosts
- **Alert Management**: Manage alert targets
- **Secure Authentication**: Basic authentication with Ambari server
- **Configurable**: Environment-based configuration
- **Type-Safe**: Built with TypeScript for better reliability

## Available Tools

### Cluster Operations
- `ambari_clusters_getclusters` - Returns all clusters
- `ambari_clusters_getcluster` - Returns information about a specific cluster
- `ambari_clusters_createcluster` - Creates a new cluster

### Service Operations
- `ambari_services_getservices` - Get all services for a cluster
- `ambari_services_getservice` - Get details of a specific service
- `ambari_services_getservicestate` - Get detailed state information for a specific service
- `ambari_services_startservice` - Start a specific service on the cluster
- `ambari_services_stopservice` - Stop a specific service on the cluster

### Service Restart & Configuration Management
- `ambari_services_getserviceswithstaleconfigs` - Get services and components that have stale configurations requiring restart
- `ambari_services_gethostcomponentswithstaleconfigs` - Get host components that need restart due to stale configurations
- `ambari_services_restartservice` - Restart a specific service on the cluster (supports rolling restart)
- `ambari_services_restartcomponents` - Restart specific components that have stale configurations
- `ambari_services_getrollingrestartstatus` - Get the status of rolling restart operations for services

### Service Maintenance Mode Management
- `ambari_services_enablemaintenancemode` - Enable maintenance mode for a service or component
- `ambari_services_disablemaintenancemode` - Disable maintenance mode for a service or component

### Service Check Operations
- `ambari_services_runservicecheck` - Run service check for a specific service to verify it is working correctly
- `ambari_services_isservicechecksupported` - Check if service check is supported for a specific service in the stack
- `ambari_services_getservicecheckstatus` - Get the status of recent service check operations for a service

### Host Operations
- `ambari_hosts_gethosts` - Returns a collection of all hosts
- `ambari_hosts_gethost` - Returns information about a single host

### Alert Operations
- `ambari_alerts_gettargets` - Returns all alert targets
- `ambari_alerts_getalerts` - Get all alerts for a cluster with filtering options
- `ambari_alerts_getalertsummary` - Get alert summary in grouped format for a cluster
- `ambari_alerts_getalertdetails` - Get details for a specific alert definition
- `ambari_alerts_getalertdefinitions` - Get all alert definitions for a cluster
- `ambari_alerts_updatealertdefinition` - Update an alert definition (enable/disable or modify properties)

### Alert Group Management
- `ambari_alerts_getalertgroups` - Get all alert groups for a cluster
- `ambari_alerts_createalertgroup` - Create a new alert group
- `ambari_alerts_updatealertgroup` - Update an existing alert group
- `ambari_alerts_deletealertgroup` - Delete an alert group
- `ambari_alerts_duplicatealertgroup` - Duplicate an existing alert group with a new name
- `ambari_alerts_adddefinitiontogroup` - Add an alert definition to an alert group
- `ambari_alerts_removedefinitionfromgroup` - Remove an alert definition from an alert group

### Alert Notification Management
- `ambari_alerts_getnotifications` - Get all alert notification targets
- `ambari_alerts_createnotification` - Create a new alert notification target
- `ambari_alerts_updatenotification` - Update an existing alert notification target
- `ambari_alerts_deletenotification` - Delete an alert notification target
- `ambari_alerts_addnotificationtogroup` - Add a notification target to an alert group
- `ambari_alerts_removenotificationfromgroup` - Remove a notification target from an alert group

### Alert Settings
- `ambari_alerts_savealertsettings` - Save cluster-level alert settings (like repeat tolerance)

## Installation

1. Clone or copy this server to your local machine
2. Install dependencies:
   ```bash
   npm install
   ```

3. Install dev dependencies (if not already installed):
   ```bash
   npm install typescript @types/node --save-dev
   ```

## Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your Ambari server details:
   ```env
   AMBARI_BASE_URL=http://your-ambari-server:8080/api/v1
   AMBARI_USERNAME=admin
   AMBARI_PASSWORD=admin
   TIMEOUT_MS=30000
   ```

## Building

Build the TypeScript code:
```bash
npm run build
```

## Usage

### As a Standalone Server
Run the server directly:
```bash
npm start
```

### With MCP Clients

#### Claude Desktop
Add to your Claude Desktop configuration:
```json
{
  "mcpServers": {
    "ambari": {
      "command": "node",
      "args": ["/path/to/ambari-mcp-server/dist/index.js"]
    }
  }
}
```

#### Other MCP Clients
The server communicates via stdio and follows the MCP protocol specification.

## Development

### Project Structure
```
ambari-mcp-server/
├── src/
│   └── index.ts          # Main server implementation
├── dist/                 # Compiled JavaScript (after build)
├── .env.example         # Environment configuration template
├── package.json         # Node.js dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── README.md           # This file
```

### Development Commands
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Build and run the server
- `npm start` - Run the compiled server

### Adding New Tools

1. Add the tool definition to the `AMBARI_TOOLS` array
2. Implement the tool executor in the `toolExecutors` object
3. Update this README with the new tool documentation

Example:
```typescript
// Add to AMBARI_TOOLS
{
  name: 'ambari_new_operation',
  description: 'Description of the new operation',
  inputSchema: {
    type: 'object',
    properties: {
      // Define input parameters
    },
    required: ['requiredParam']
  }
}

// Add to toolExecutors
ambari_new_operation: async (args) => {
  return executeAmbariRequest('GET', '/new-endpoint', args);
}
```

## Error Handling

The server includes comprehensive error handling:
- Network timeouts and connection errors
- HTTP error responses from Ambari
- Invalid tool parameters
- Authentication failures

Errors are returned as MCP error responses with appropriate error codes and messages.

## Security Considerations

- Store sensitive credentials in environment variables
- Use HTTPS for Ambari server connections in production
- Implement proper authentication and authorization
- Consider network security between MCP client and server

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if Ambari server is running and accessible
2. **Authentication Failed**: Verify username and password in `.env`
3. **Timeout Errors**: Increase `TIMEOUT_MS` value
4. **Build Errors**: Ensure TypeScript and dependencies are installed

### Debug Mode
Set environment variable `DEBUG=1` for verbose logging:
```bash
DEBUG=1 npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License - see package.json for details

## Related Links

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Apache Ambari](https://ambari.apache.org/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
