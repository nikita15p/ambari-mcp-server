/* START GENAI */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  Tool,
  Resource,
  TextContent,
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosRequestConfig } from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Load environment variables immediately
dotenv.config();

// Emulate __dirname in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust .env loading: handle different working directories when launched by MCP host
function loadEnv() {
  // Allow explicit override via AMBARI_ENV_PATH
  const explicit = process.env.AMBARI_ENV_PATH ? path.resolve(process.env.AMBARI_ENV_PATH) : undefined;
  const candidatePaths = [
    explicit,
    path.resolve(__dirname, '../.env'), // when running built dist/index.js
    path.resolve(process.cwd(), '.env') // when running from project root
  ].filter(Boolean) as string[];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      console.error(`[env] Loaded .env from ${p}`);
      return p;
    }
  }
  console.error('[env] WARNING: .env file not found. Tried:', candidatePaths.join(', '));
  return undefined;
}

const loadedEnvPath = loadEnv();

function summarizeEnv() {
  const baseUrl = process.env.AMBARI_BASE_URL;
  const user = process.env.AMBARI_USERNAME;
  const pwd = process.env.AMBARI_PASSWORD;
  const timeout = process.env.TIMEOUT_MS;
  const maskedPwd = pwd ? pwd.replace(/./g, '*') : 'undefined';
  console.error('[env] Summary:', JSON.stringify({
    loadedEnvPath,
    AMBARI_BASE_URL: baseUrl,
    AMBARI_USERNAME: user,
    AMBARI_PASSWORD_MASKED: maskedPwd,
    TIMEOUT_MS: timeout,
  }, null, 2));
  if (!baseUrl) {
    console.error('[env] WARNING: AMBARI_BASE_URL is missing; falling back to default http://localhost:8080/api/v1');
  }
}

if (process.env.ENV_DEBUG === '1') summarizeEnv();

// Server configuration
const server = new Server(
  {
    name: 'ambari-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

// Configuration from environment variables
const AMBARI_BASE_URL = process.env.AMBARI_BASE_URL || 'http://localhost:8080/api/v1';
const AMBARI_USERNAME = process.env.AMBARI_USERNAME || 'admin';
const AMBARI_PASSWORD = process.env.AMBARI_PASSWORD || 'admin';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);

// Tool definitions for common Ambari operations - MCP-compliant with proper JSON Schema
const AMBARI_TOOLS: Tool[] = [
  {
    name: 'ambari_clusters_getclusters',
    description: 'Returns all clusters',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'string',
          description: 'Filter fields in the response (identifier fields are mandatory)',
          default: 'Clusters/*'
        },
        sortBy: {
          type: 'string',
          description: 'Sort resources in result by (asc | desc)'
        },
        page_size: {
          type: 'integer',
          description: 'The number of resources to be returned for the paged response.',
          default: 10
        },
        from: {
          type: 'integer',
          description: 'The starting page resource (inclusive). "start" is also accepted.',
          default: 0
        },
        to: {
          type: 'integer',
          description: 'The ending page resource (inclusive). "end" is also accepted.'
        }
      },
      required: []
    }
  },
  {
    name: 'ambari_clusters_getcluster',
    description: 'Returns information about a specific cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response (identifier fields are mandatory)',
          default: 'Clusters/*'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_clusters_createcluster',
    description: 'Creates a cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster to create'
        },
        body: {
          type: 'string',
          description: 'JSON body for cluster creation'
        }
      },
      required: ['clusterName', 'body']
    }
  },
  {
    name: 'ambari_services_getservices',
    description: 'Get all services for a cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: 'ServiceInfo/service_name,ServiceInfo/cluster_name'
        },
        sortBy: {
          type: 'string',
          description: 'Sort resources in result by (asc | desc)',
          default: 'ServiceInfo/service_name.asc'
        },
        page_size: {
          type: 'integer',
          description: 'The number of resources to be returned for the paged response.',
          default: 10
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_services_getservice',
    description: 'Get the details of a service',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: 'ServiceInfo/*'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_hosts_gethosts',
    description: 'Returns a collection of all hosts',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: 'Hosts/*'
        },
        sortBy: {
          type: 'string',
          description: 'Sort resources in result by (asc | desc)',
          default: 'Hosts/host_name.asc'
        },
        page_size: {
          type: 'integer',
          description: 'The number of resources to be returned for the paged response.',
          default: 10
        }
      },
      required: []
    }
  },
  {
    name: 'ambari_hosts_gethost',
    description: 'Returns information about a single host',
    inputSchema: {
      type: 'object',
      properties: {
        hostName: {
          type: 'string',
          description: 'The name of the host'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: 'Hosts/*'
        }
      },
      required: ['hostName']
    }
  },
  {
    name: 'ambari_alerts_gettargets',
    description: 'Returns all alert targets',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: 'AlertTarget/*'
        },
        sortBy: {
          type: 'string',
          description: 'Sort resources in result by (asc | desc)'
        },
        page_size: {
          type: 'integer',
          description: 'The number of resources to be returned for the paged response.',
          default: 10
        }
      },
      required: []
    }
  },
  {
    name: 'ambari_alerts_getalerts',
    description: 'Get all alerts for a cluster with filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: '*'
        },
        hostName: {
          type: 'string',
          description: 'Filter alerts by host name (optional)'
        },
        componentName: {
          type: 'string',
          description: 'Filter alerts by component name (optional)'
        },
        state: {
          type: 'string',
          description: 'Filter alerts by state (CRITICAL, WARNING, OK, UNKNOWN)'
        },
        maintenanceState: {
          type: 'string',
          description: 'Filter alerts by maintenance state (ON, OFF)'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_alerts_getalertsummary',
    description: 'Get alert summary in grouped format for a cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        maintenanceFilter: {
          type: 'boolean',
          description: 'Filter out alerts in maintenance mode',
          default: false
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_alerts_getalertdetails',
    description: 'Get details for a specific alert definition',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        alertId: {
          type: 'string',
          description: 'The alert definition ID'
        }
      },
      required: ['clusterName', 'alertId']
    }
  },
  {
    name: 'ambari_alerts_getalertdefinitions',
    description: 'Get all alert definitions for a cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        fields: {
          type: 'string',
          description: 'Filter fields in the response',
          default: '*'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_alerts_updatealertdefinition',
    description: 'Update an alert definition (enable/disable or modify properties)',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        definitionId: {
          type: 'string',
          description: 'The alert definition ID'
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the alert definition (optional)'
        },
        data: {
          type: 'string',
          description: 'JSON string of additional properties to update (optional)'
        }
      },
      required: ['clusterName', 'definitionId']
    }
  },
  {
    name: 'ambari_alerts_getalertgroups',
    description: 'Get all alert groups for a cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_alerts_createalertgroup',
    description: 'Create a new alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupName: {
          type: 'string',
          description: 'Name of the alert group'
        },
        definitions: {
          type: 'string',
          description: 'JSON array of definition IDs to include in the group (optional)'
        }
      },
      required: ['clusterName', 'groupName']
    }
  },
  {
    name: 'ambari_alerts_updatealertgroup',
    description: 'Update an existing alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID'
        },
        groupName: {
          type: 'string',
          description: 'New name for the alert group'
        },
        definitions: {
          type: 'string',
          description: 'JSON array of definition IDs to include in the group (optional)'
        }
      },
      required: ['clusterName', 'groupId', 'groupName']
    }
  },
  {
    name: 'ambari_alerts_deletealertgroup',
    description: 'Delete an alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID to delete'
        }
      },
      required: ['clusterName', 'groupId']
    }
  },
  {
    name: 'ambari_alerts_duplicatealertgroup',
    description: 'Duplicate an existing alert group with a new name',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        sourceGroupId: {
          type: 'integer',
          description: 'The ID of the alert group to duplicate'
        },
        newGroupName: {
          type: 'string',
          description: 'Name for the new duplicated group'
        }
      },
      required: ['clusterName', 'sourceGroupId', 'newGroupName']
    }
  },
  {
    name: 'ambari_alerts_adddefinitiontogroup',
    description: 'Add an alert definition to an alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID'
        },
        definitionId: {
          type: 'integer',
          description: 'The alert definition ID to add'
        }
      },
      required: ['clusterName', 'groupId', 'definitionId']
    }
  },
  {
    name: 'ambari_alerts_removedefinitionfromgroup',
    description: 'Remove an alert definition from an alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID'
        },
        definitionId: {
          type: 'integer',
          description: 'The alert definition ID to remove'
        }
      },
      required: ['clusterName', 'groupId', 'definitionId']
    }
  },
  {
    name: 'ambari_alerts_getnotifications',
    description: 'Get all alert notification targets',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_alerts_createnotification',
    description: 'Create a new alert notification target',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        notificationData: {
          type: 'string',
          description: 'JSON string containing notification target data (name, description, notification_type, properties, etc.)'
        }
      },
      required: ['clusterName', 'notificationData']
    }
  },
  {
    name: 'ambari_alerts_updatenotification',
    description: 'Update an existing alert notification target',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        targetId: {
          type: 'integer',
          description: 'The notification target ID'
        },
        notificationData: {
          type: 'string',
          description: 'JSON string containing updated notification target data'
        }
      },
      required: ['clusterName', 'targetId', 'notificationData']
    }
  },
  {
    name: 'ambari_alerts_deletenotification',
    description: 'Delete an alert notification target',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        targetId: {
          type: 'integer',
          description: 'The notification target ID to delete'
        }
      },
      required: ['clusterName', 'targetId']
    }
  },
  {
    name: 'ambari_alerts_addnotificationtogroup',
    description: 'Add a notification target to an alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID'
        },
        targetId: {
          type: 'integer',
          description: 'The notification target ID'
        }
      },
      required: ['clusterName', 'groupId', 'targetId']
    }
  },
  {
    name: 'ambari_alerts_removenotificationfromgroup',
    description: 'Remove a notification target from an alert group',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        groupId: {
          type: 'integer',
          description: 'The alert group ID'
        },
        targetId: {
          type: 'integer',
          description: 'The notification target ID'
        }
      },
      required: ['clusterName', 'groupId', 'targetId']
    }
  },
  {
    name: 'ambari_alerts_savealertsettings',
    description: 'Save cluster-level alert settings (like repeat tolerance)',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        alertRepeatTolerance: {
          type: 'integer',
          description: 'Alert repeat tolerance value (number of times to repeat alerts)',
          default: 1
        }
      },
      required: ['clusterName', 'alertRepeatTolerance']
    }
  },
  {
    name: 'ambari_services_getserviceswithstaleconfigs',
    description: 'Get services and components that have stale configurations requiring restart',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'Filter by specific service name (optional)'
        },
        onlyStaleConfigs: {
          type: 'boolean',
          description: 'Only return components with stale configurations',
          default: true
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_services_gethostcomponentswithstaleconfigs',
    description: 'Get host components that need restart due to stale configurations',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        hostName: {
          type: 'string',
          description: 'Filter by specific host name (optional)'
        },
        serviceName: {
          type: 'string',
          description: 'Filter by specific service name (optional)'
        },
        componentName: {
          type: 'string',
          description: 'Filter by specific component name (optional)'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_services_restartservice',
    description: 'Restart a specific service on the cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service to restart'
        },
        context: {
          type: 'string',
          description: 'Context message for the restart operation',
          default: 'Restart service via MCP'
        },
        restartType: {
          type: 'string',
          description: 'Type of restart operation',
          enum: ['RESTART', 'ROLLING_RESTART'],
          default: 'RESTART'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_restartcomponents',
    description: 'Restart specific components that have stale configurations',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        componentName: {
          type: 'string',
          description: 'The name of the component to restart'
        },
        hostNames: {
          type: 'string',
          description: 'JSON array of host names to restart the component on (optional - restarts all if not provided)'
        },
        context: {
          type: 'string',
          description: 'Context message for the restart operation',
          default: 'Restart components via MCP'
        }
      },
      required: ['clusterName', 'serviceName', 'componentName']
    }
  },
  {
    name: 'ambari_services_getservicestate',
    description: 'Get detailed state information for a specific service',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        fields: {
          type: 'string',
          description: 'Specific fields to return',
          default: 'ServiceInfo/*,components/ServiceComponentInfo/*,components/host_components/HostRoles/state,components/host_components/HostRoles/stale_configs'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_startservice',
    description: 'Start a specific service on the cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service to start'
        },
        context: {
          type: 'string',
          description: 'Context message for the start operation',
          default: 'Start service via MCP'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_stopservice',
    description: 'Stop a specific service on the cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service to stop'
        },
        context: {
          type: 'string',
          description: 'Context message for the stop operation',
          default: 'Stop service via MCP'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_getrollingrestartstatus',
    description: 'Get the status of rolling restart operations for services',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'Filter by specific service name (optional)'
        },
        requestId: {
          type: 'string',
          description: 'Filter by specific request ID (optional)'
        }
      },
      required: ['clusterName']
    }
  },
  {
    name: 'ambari_services_enablemaintenancemode',
    description: 'Enable maintenance mode for a service or component',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        componentName: {
          type: 'string',
          description: 'The name of the component (optional - applies to entire service if not provided)'
        },
        hostName: {
          type: 'string',
          description: 'The name of the host (required if componentName is provided)'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_disablemaintenancemode',
    description: 'Disable maintenance mode for a service or component',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        componentName: {
          type: 'string',
          description: 'The name of the component (optional - applies to entire service if not provided)'
        },
        hostName: {
          type: 'string',
          description: 'The name of the host (required if componentName is provided)'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_runservicecheck',
    description: 'Run service check for a specific service to verify it is working correctly',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service to check'
        },
        context: {
          type: 'string',
          description: 'Context message for the service check operation',
          default: 'Service Check via MCP'
        }
      },
      required: ['clusterName', 'serviceName']
    }
  },
  {
    name: 'ambari_services_isservicechecksupported',
    description: 'Check if service check is supported for a specific service in the stack',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'The name of the service'
        },
        stackName: {
          type: 'string',
          description: 'The stack name (e.g., HDP, VDP)'
        },
        stackVersion: {
          type: 'string',
          description: 'The stack version (e.g., 3.1, 2.6)'
        }
      },
      required: ['clusterName', 'serviceName', 'stackName', 'stackVersion']
    }
  },
  {
    name: 'ambari_services_getservicecheckstatus',
    description: 'Get the status of recent service check operations for a service',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'The name of the cluster'
        },
        serviceName: {
          type: 'string',
          description: 'Filter by specific service name (optional)'
        },
        requestId: {
          type: 'string',
          description: 'Filter by specific request ID (optional)'
        }
      },
      required: ['clusterName']
    }
  }
];

// Helper function to execute Ambari API calls
async function executeAmbariRequest(
  method: string,
  path: string,
  params: Record<string, any> = {},
  body?: any
): Promise<any> {
  const url = `${AMBARI_BASE_URL}${path}`;
  
  const config: AxiosRequestConfig = {
    url,
    method: method.toLowerCase() as any,
    auth: {
      username: AMBARI_USERNAME,
      password: AMBARI_PASSWORD,
    },
    timeout: TIMEOUT_MS,
    params: Object.keys(params).length ? params : undefined,
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-By': 'ambari-mcp-server',
    },
  };

  try {
    const response = await axios(config);
    return {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
    };
  } catch (error: any) {
    // Build richer diagnostics for different failure modes
    const hasResponse = !!error.response;
    const status = hasResponse ? error.response.status : undefined;
    const statusText = hasResponse ? error.response.statusText : undefined;
    const data = hasResponse ? error.response.data : undefined;
    const code = error.code; // e.g. ECONNREFUSED, ECONNABORTED (timeout)
    const isTimeout = code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
    const methodUpper = (config.method || method).toString().toUpperCase();

    const summaryParts: string[] = [];
    summaryParts.push(`${methodUpper} ${url}`);
    if (status) summaryParts.push(`HTTP ${status}${statusText ? ' ' + statusText : ''}`);
    if (code && !status) summaryParts.push(`Code ${code}`);
    if (isTimeout) summaryParts.push('Timeout');
    if (!hasResponse && !code) summaryParts.push('No response');

    const baseSummary = summaryParts.join(' | ');

    const details: Record<string, any> = {
      url,
      method: methodUpper,
      params: params && Object.keys(params).length ? params : undefined,
      timeoutMs: TIMEOUT_MS,
      code,
      status,
      statusText,
    };
    if (isTimeout) details.timeout = true;
    if (data) details.responseBody = data;
    if (error.message && error.message !== 'Error') details.message = error.message;

    // Serialize details compactly but still readable
    const serializedDetails = JSON.stringify(details, null, 2);
    throw new McpError(
      ErrorCode.InternalError,
      `Ambari API Error: ${baseSummary}`,
      { diagnostics: serializedDetails }
    );
  }
}

// Tool execution mapping
const toolExecutors: Record<string, (args: any) => Promise<any>> = {
  ambari_clusters_getclusters: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    if (args.sortBy) params.sortBy = args.sortBy;
    if (args.page_size) params.page_size = args.page_size;
    if (args.from !== undefined) params.from = args.from;
    if (args.to !== undefined) params.to = args.to;
    
    return executeAmbariRequest('GET', '/clusters', params);
  },

  ambari_clusters_getcluster: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}`, params);
  },

  ambari_clusters_createcluster: async (args) => {
    const body = typeof args.body === 'string' ? JSON.parse(args.body) : args.body;
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}`, {}, body);
  },

  ambari_services_getservices: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    if (args.sortBy) params.sortBy = args.sortBy;
    if (args.page_size) params.page_size = args.page_size;
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/services`, params);
  },

  ambari_services_getservice: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/services/${args.serviceName}`, params);
  },

  ambari_hosts_gethosts: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    if (args.sortBy) params.sortBy = args.sortBy;
    if (args.page_size) params.page_size = args.page_size;
    
    return executeAmbariRequest('GET', '/hosts', params);
  },

  ambari_hosts_gethost: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    
    return executeAmbariRequest('GET', `/hosts/${args.hostName}`, params);
  },

  ambari_alerts_gettargets: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    if (args.sortBy) params.sortBy = args.sortBy;
    if (args.page_size) params.page_size = args.page_size;
    
    return executeAmbariRequest('GET', '/alert_targets', params);
  },

  ambari_alerts_getalerts: async (args) => {
    const params: Record<string, any> = {};
    if (args.fields) params.fields = args.fields;
    if (args.hostName) params['Alert/host_name'] = args.hostName;
    if (args.componentName) params['Alert/component_name'] = args.componentName;
    if (args.state) params['Alert/state'] = args.state;
    if (args.maintenanceState) params['Alert/maintenance_state'] = args.maintenanceState;
    
    // Add timestamp to prevent caching
    params._ = Date.now();
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/alerts`, params);
  },

  ambari_alerts_getalertsummary: async (args) => {
    const params: Record<string, any> = {
      format: 'groupedSummary',
      _: Date.now()
    };
    
    // Add maintenance mode filter if requested
    if (args.maintenanceFilter) {
      params['Alert/maintenance_state.in'] = 'OFF';
    }
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/alerts`, params);
  },

  ambari_alerts_getalertdetails: async (args) => {
    const params: Record<string, any> = {
      fields: '*',
      'Alert/definition_id': args.alertId,
      _: Date.now()
    };
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/alerts`, params);
  },

  ambari_alerts_getalertdefinitions: async (args) => {
    const params: Record<string, any> = {
      fields: args.fields || '*',
      _: Date.now()
    };
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/alert_definitions`, params);
  },

  ambari_alerts_updatealertdefinition: async (args) => {
    let body: any = {};
    
    // Handle enabled/disabled state
    if (args.enabled !== undefined) {
      body['AlertDefinition/enabled'] = args.enabled;
    }
    
    // Handle additional data if provided
    if (args.data) {
      const additionalData = typeof args.data === 'string' ? JSON.parse(args.data) : args.data;
      body = { ...body, ...additionalData };
    }
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/alert_definitions/${args.definitionId}`, {}, body);
  },

  ambari_alerts_getalertgroups: async (args) => {
    const params: Record<string, any> = {
      fields: '*',
      _: Date.now()
    };
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/alert_groups`, params);
  },

  ambari_alerts_createalertgroup: async (args) => {
    const body: any = {
      AlertGroup: {
        name: args.groupName
      }
    };
    
    // Add definitions if provided
    if (args.definitions) {
      const definitions = typeof args.definitions === 'string' ? JSON.parse(args.definitions) : args.definitions;
      body.AlertGroup.definitions = definitions;
    }
    
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}/alert_groups`, {}, body);
  },

  ambari_alerts_updatealertgroup: async (args) => {
    const body: any = {
      AlertGroup: {
        name: args.groupName
      }
    };
    
    // Add definitions if provided
    if (args.definitions) {
      const definitions = typeof args.definitions === 'string' ? JSON.parse(args.definitions) : args.definitions;
      body.AlertGroup.definitions = definitions;
    }
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/alert_groups/${args.groupId}`, {}, body);
  },

  ambari_alerts_deletealertgroup: async (args) => {
    return executeAmbariRequest('DELETE', `/clusters/${args.clusterName}/alert_groups/${args.groupId}`);
  },

  ambari_alerts_duplicatealertgroup: async (args) => {
    // First get the source group details
    const sourceGroupResponse = await executeAmbariRequest('GET', `/clusters/${args.clusterName}/alert_groups/${args.sourceGroupId}`, { fields: '*' });
    
    const sourceGroup = sourceGroupResponse.data.AlertGroup;
    const definitionIds: number[] = [];
    
    // Extract definition IDs
    if (sourceGroup.definitions) {
      sourceGroup.definitions.forEach((def: any) => {
        if (typeof def === 'number') {
          definitionIds.push(def);
        } else if (def && typeof def === 'object' && 'id' in def) {
          definitionIds.push(Number(def.id));
        }
      });
    }
    
    // Create new group with same definitions
    const body = {
      AlertGroup: {
        name: args.newGroupName,
        definitions: definitionIds
      }
    };
    
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}/alert_groups`, {}, body);
  },

  ambari_alerts_adddefinitiontogroup: async (args) => {
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}/alert_groups/${args.groupId}/alert_definitions/${args.definitionId}`);
  },

  ambari_alerts_removedefinitionfromgroup: async (args) => {
    return executeAmbariRequest('DELETE', `/clusters/${args.clusterName}/alert_groups/${args.groupId}/alert_definitions/${args.definitionId}`);
  },

  ambari_alerts_getnotifications: async (args) => {
    const params: Record<string, any> = {
      fields: '*',
      _: Date.now()
    };
    
    return executeAmbariRequest('GET', '/alert_targets', params);
  },

  ambari_alerts_createnotification: async (args) => {
    const body = typeof args.notificationData === 'string' ? JSON.parse(args.notificationData) : args.notificationData;
    return executeAmbariRequest('POST', '/alert_targets', {}, body);
  },

  ambari_alerts_updatenotification: async (args) => {
    const body = typeof args.notificationData === 'string' ? JSON.parse(args.notificationData) : args.notificationData;
    return executeAmbariRequest('PUT', `/alert_targets/${args.targetId}`, {}, body);
  },

  ambari_alerts_deletenotification: async (args) => {
    return executeAmbariRequest('DELETE', `/alert_targets/${args.targetId}`);
  },

  ambari_alerts_addnotificationtogroup: async (args) => {
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}/alert_groups/${args.groupId}/alert_targets/${args.targetId}`);
  },

  ambari_alerts_removenotificationfromgroup: async (args) => {
    return executeAmbariRequest('DELETE', `/clusters/${args.clusterName}/alert_groups/${args.groupId}/alert_targets/${args.targetId}`);
  },

  ambari_alerts_savealertsettings: async (args) => {
    // First get current cluster-env configuration
    const currentConfigResponse = await executeAmbariRequest('GET', `/clusters/${args.clusterName}/configurations`, { type: 'cluster-env', fields: '*' });
    
    let currentProperties = {};
    if (currentConfigResponse.data && currentConfigResponse.data.items && currentConfigResponse.data.items.length > 0) {
      const latestConfig = currentConfigResponse.data.items[0];
      currentProperties = latestConfig.properties || {};
    }
    
    // Update the alerts_repeat_tolerance property
    const updatedProperties = {
      ...currentProperties,
      alerts_repeat_tolerance: args.alertRepeatTolerance.toString()
    };
    
    const body = {
      Clusters: {
        desired_config: {
          type: "cluster-env",
          properties: updatedProperties
        }
      }
    };
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}`, {}, body);
  },

  ambari_services_getserviceswithstaleconfigs: async (args) => {
    const params: Record<string, any> = {
      fields: 'ServiceInfo/service_name,ServiceInfo/state,ServiceInfo/maintenance_state,components/ServiceComponentInfo/component_name,components/ServiceComponentInfo/category,components/host_components/HostRoles/state,components/host_components/HostRoles/stale_configs,components/host_components/HostRoles/host_name,components/host_components/HostRoles/component_name',
      _: Date.now()
    };
    
    if (args.serviceName) {
      return executeAmbariRequest('GET', `/clusters/${args.clusterName}/services/${args.serviceName}`, params);
    } else {
      const response = await executeAmbariRequest('GET', `/clusters/${args.clusterName}/services`, params);
      
      // Filter services/components with stale configs if requested
      if (args.onlyStaleConfigs) {
        const filteredServices = response.data.items.filter((service: any) => {
          return service.components?.some((component: any) => 
            component.host_components?.some((hostComponent: any) => 
              hostComponent.HostRoles?.stale_configs === true
            )
          );
        });
        response.data.items = filteredServices;
      }
      
      return response;
    }
  },

  ambari_services_gethostcomponentswithstaleconfigs: async (args) => {
    const params: Record<string, any> = {
      fields: 'HostRoles/component_name,HostRoles/host_name,HostRoles/service_name,HostRoles/state,HostRoles/stale_configs,HostRoles/maintenance_state',
      'HostRoles/stale_configs': 'true',
      _: Date.now()
    };
    
    if (args.hostName) {
      params['HostRoles/host_name'] = args.hostName;
    }
    if (args.serviceName) {
      params['HostRoles/service_name'] = args.serviceName;
    }
    if (args.componentName) {
      params['HostRoles/component_name'] = args.componentName;
    }
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/host_components`, params);
  },

  ambari_services_restartservice: async (args) => {
    const body = {
      RequestInfo: {
        context: args.context || 'Restart service via MCP',
        command: args.restartType || 'RESTART',
        operation_level: {
          level: 'SERVICE',
          cluster_name: args.clusterName,
          service_name: args.serviceName
        }
      },
      Body: {
        ServiceInfo: {
          state: 'STARTED'
        }
      }
    };
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/services/${args.serviceName}`, {}, body);
  },

  ambari_services_restartcomponents: async (args) => {
    let hostFilter = '';
    if (args.hostNames) {
      const hostNames = typeof args.hostNames === 'string' ? JSON.parse(args.hostNames) : args.hostNames;
      hostFilter = `HostRoles/host_name.in(${hostNames.join(',')})&`;
    }
    
    const body = {
      RequestInfo: {
        context: args.context || 'Restart components via MCP',
        command: 'RESTART',
        operation_level: {
          level: 'HOST_COMPONENT',
          cluster_name: args.clusterName,
          service_name: args.serviceName,
          hostcomponent_name: args.componentName
        }
      },
      Body: {
        HostRoles: {
          state: 'STARTED'
        }
      }
    };
    
    const urlParams = `${hostFilter}HostRoles/component_name=${args.componentName}&HostRoles/service_name=${args.serviceName}`;
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/host_components?${urlParams}`, {}, body);
  },

  ambari_services_getservicestate: async (args) => {
    const params: Record<string, any> = {
      fields: args.fields || 'ServiceInfo/*,components/ServiceComponentInfo/*,components/host_components/HostRoles/state,components/host_components/HostRoles/stale_configs'
    };
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/services/${args.serviceName}`, params);
  },

  ambari_services_startservice: async (args) => {
    const body = {
      RequestInfo: {
        context: args.context || 'Start service via MCP',
        operation_level: {
          level: 'SERVICE',
          cluster_name: args.clusterName,
          service_name: args.serviceName
        }
      },
      Body: {
        ServiceInfo: {
          state: 'STARTED'
        }
      }
    };
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/services/${args.serviceName}`, {}, body);
  },

  ambari_services_stopservice: async (args) => {
    const body = {
      RequestInfo: {
        context: args.context || 'Stop service via MCP',
        operation_level: {
          level: 'SERVICE',
          cluster_name: args.clusterName,
          service_name: args.serviceName
        }
      },
      Body: {
        ServiceInfo: {
          state: 'INSTALLED'
        }
      }
    };
    
    return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/services/${args.serviceName}`, {}, body);
  },

  ambari_services_getrollingrestartstatus: async (args) => {
    const params: Record<string, any> = {
      fields: 'Requests/id,Requests/request_context,Requests/request_status,Requests/progress_percent,Requests/start_time,Requests/end_time,tasks/Tasks/command_name,tasks/Tasks/status,tasks/Tasks/host_name,tasks/Tasks/role',
      _: Date.now()
    };
    
    if (args.serviceName) {
      params['tasks/Tasks/role.in'] = args.serviceName;
    }
    if (args.requestId) {
      return executeAmbariRequest('GET', `/clusters/${args.clusterName}/requests/${args.requestId}`, params);
    }
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/requests`, params);
  },

  ambari_services_enablemaintenancemode: async (args) => {
    if (args.componentName && args.hostName) {
      // Enable maintenance mode for specific host component
      const body = {
        HostRoles: {
          maintenance_state: 'ON'
        }
      };
      return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/hosts/${args.hostName}/host_components/${args.componentName}`, {}, body);
    } else {
      // Enable maintenance mode for entire service
      const body = {
        RequestInfo: {
          context: 'Enable Maintenance Mode via MCP'
        },
        Body: {
          ServiceInfo: {
            maintenance_state: 'ON'
          }
        }
      };
      return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/services/${args.serviceName}`, {}, body);
    }
  },

  ambari_services_disablemaintenancemode: async (args) => {
    if (args.componentName && args.hostName) {
      // Disable maintenance mode for specific host component
      const body = {
        HostRoles: {
          maintenance_state: 'OFF'
        }
      };
      return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/hosts/${args.hostName}/host_components/${args.componentName}`, {}, body);
    } else {
      // Disable maintenance mode for entire service
      const body = {
        RequestInfo: {
          context: 'Disable Maintenance Mode via MCP'
        },
        Body: {
          ServiceInfo: {
            maintenance_state: 'OFF'
          }
        }
      };
      return executeAmbariRequest('PUT', `/clusters/${args.clusterName}/services/${args.serviceName}`, {}, body);
    }
  },

  ambari_services_runservicecheck: async (args) => {
    let body: any = {};
    
    // Handle special service check commands based on service type
    if (args.serviceName === 'ZOOKEEPER') {
      // ZooKeeper uses quorum service check
      body = {
        RequestInfo: {
          command: `${args.serviceName}_QUORUM_SERVICE_CHECK`,
          context: args.context || `${args.serviceName} Service Check`,
          operation_level: {
            level: 'CLUSTER',
            cluster_name: args.clusterName
          }
        },
        'Requests/resource_filters': [
          {
            service_name: args.serviceName
          }
        ]
      };
    } else if (args.serviceName === 'TEZ' || args.serviceName === 'SQOOP' || args.serviceName === 'KERBEROS') {
      // Client-only services use different service check format
      body = {
        RequestInfo: {
          context: args.context || `${args.serviceName} Service Check`,
          command: `${args.serviceName}_SERVICE_CHECK`
        },
        'Requests/resource_filters': [
          {
            service_name: args.serviceName
          }
        ]
      };
    } else {
      // Standard service check for most services
      body = {
        RequestInfo: {
          command: `${args.serviceName}_SERVICE_CHECK`,
          context: args.context || `${args.serviceName} Service Check`,
          operation_level: {
            level: 'CLUSTER',
            cluster_name: args.clusterName
          }
        },
        'Requests/resource_filters': [
          {
            service_name: args.serviceName
          }
        ]
      };
    }
    
    return executeAmbariRequest('POST', `/clusters/${args.clusterName}/requests`, {}, body);
  },

  ambari_services_isservicechecksupported: async (args) => {
    const params: Record<string, any> = {
      fields: 'StackServices/service_check_supported',
      _: Date.now()
    };
    
    return executeAmbariRequest('GET', `/stacks/${args.stackName}/versions/${args.stackVersion}/services/${args.serviceName}`, params);
  },

  ambari_services_getservicecheckstatus: async (args) => {
    const params: Record<string, any> = {
      fields: 'Requests/id,Requests/request_context,Requests/request_status,Requests/progress_percent,Requests/start_time,Requests/end_time,tasks/Tasks/command_name,tasks/Tasks/status,tasks/Tasks/host_name,tasks/Tasks/role',
      _: Date.now()
    };
    
    // Filter by service check commands
    params['Requests/request_context.matches'] = '.*Service Check.*';
    
    if (args.serviceName) {
      params['tasks/Tasks/role.in'] = args.serviceName;
    }
    if (args.requestId) {
      return executeAmbariRequest('GET', `/clusters/${args.clusterName}/requests/${args.requestId}`, params);
    }
    
    return executeAmbariRequest('GET', `/clusters/${args.clusterName}/requests`, params);
  },
};

/* START GENAI */
// MCP Resources - Provide structured access to Ambari data
const AMBARI_RESOURCES: Resource[] = [
  {
    uri: 'ambari://clusters',
    name: 'Ambari Clusters',
    description: 'List of all Ambari clusters with basic information',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}',
    name: 'Cluster Details',
    description: 'Detailed information about a specific cluster including services and hosts',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/services',
    name: 'Cluster Services',
    description: 'All services running in a specific cluster with their status',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/hosts',
    name: 'Cluster Hosts',
    description: 'All hosts in a specific cluster with their status and components',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/alerts',
    name: 'Cluster Alerts',
    description: 'Current alerts for a specific cluster grouped by severity',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/alerts/summary',
    name: 'Alert Summary',
    description: 'Summarized alert information for quick cluster health overview',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/services/stale-configs',
    name: 'Stale Configurations',
    description: 'Services and components that need restart due to configuration changes',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/service/{serviceName}',
    name: 'Service Details',
    description: 'Detailed information about a specific service including components and configurations',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/service/{serviceName}/components',
    name: 'Service Components',
    description: 'All components of a specific service with their host assignments and status',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://host/{hostName}',
    name: 'Host Details',
    description: 'Detailed information about a specific host including installed components',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/requests/recent',
    name: 'Recent Operations',
    description: 'Recent operations and their status (restarts, service checks, etc.)',
    mimeType: 'application/json'
  },
  {
    uri: 'ambari://cluster/{clusterName}/configurations',
    name: 'Cluster Configurations',
    description: 'Current configuration for all services in the cluster',
    mimeType: 'application/json'
  }
];

// Resource URI parser
function parseResourceUri(uri: string): { type: string; clusterName?: string; serviceName?: string; hostName?: string } {
  const match = uri.match(/^ambari:\/\/(.+)$/);
  if (!match) {
    throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI: ${uri}`);
  }

  const path = match[1];
  
  if (path === 'clusters') {
    return { type: 'clusters' };
  }
  
  if (path.startsWith('cluster/')) {
    const clusterMatch = path.match(/^cluster\/([^\/]+)(?:\/(.+))?$/);
    if (!clusterMatch) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid cluster resource URI: ${uri}`);
    }
    
    const clusterName = clusterMatch[1];
    const subPath = clusterMatch[2];
    
    if (!subPath) {
      return { type: 'cluster', clusterName };
    }
    
    if (subPath === 'services') {
      return { type: 'services', clusterName };
    }
    
    if (subPath === 'hosts') {
      return { type: 'hosts', clusterName };
    }
    
    if (subPath === 'alerts') {
      return { type: 'alerts', clusterName };
    }
    
    if (subPath === 'alerts/summary') {
      return { type: 'alerts-summary', clusterName };
    }
    
    if (subPath === 'services/stale-configs') {
      return { type: 'stale-configs', clusterName };
    }
    
    if (subPath === 'requests/recent') {
      return { type: 'recent-requests', clusterName };
    }
    
    if (subPath === 'configurations') {
      return { type: 'configurations', clusterName };
    }
    
    const serviceMatch = subPath.match(/^service\/([^\/]+)(?:\/(.+))?$/);
    if (serviceMatch) {
      const serviceName = serviceMatch[1];
      const serviceSubPath = serviceMatch[2];
      
      if (!serviceSubPath) {
        return { type: 'service', clusterName, serviceName };
      }
      
      if (serviceSubPath === 'components') {
        return { type: 'service-components', clusterName, serviceName };
      }
    }
  }
  
  if (path.startsWith('host/')) {
    const hostMatch = path.match(/^host\/(.+)$/);
    if (hostMatch) {
      return { type: 'host', hostName: hostMatch[1] };
    }
  }
  
  throw new McpError(ErrorCode.InvalidRequest, `Unsupported resource URI: ${uri}`);
}

// Resource handlers
const resourceHandlers: Record<string, (params: any) => Promise<any>> = {
  clusters: async () => {
    const response = await executeAmbariRequest('GET', '/clusters', { fields: 'Clusters/cluster_name,Clusters/version,Clusters/state,Clusters/health_report' });
    return {
      type: 'clusters',
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  cluster: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}`, { 
      fields: 'Clusters/*,services/ServiceInfo/service_name,services/ServiceInfo/state,hosts/Hosts/host_name,hosts/Hosts/host_status' 
    });
    return {
      type: 'cluster-details',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  services: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/services`, { 
      fields: 'ServiceInfo/service_name,ServiceInfo/state,ServiceInfo/maintenance_state,components/ServiceComponentInfo/component_name,components/ServiceComponentInfo/total_count,components/ServiceComponentInfo/started_count' 
    });
    return {
      type: 'cluster-services',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  hosts: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/hosts`, { 
      fields: 'Hosts/host_name,Hosts/host_status,Hosts/maintenance_state,host_components/HostRoles/component_name,host_components/HostRoles/state' 
    });
    return {
      type: 'cluster-hosts',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  alerts: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/alerts`, { 
      fields: 'Alert/definition_name,Alert/service_name,Alert/component_name,Alert/host_name,Alert/state,Alert/text,Alert/timestamp',
      _: Date.now()
    });
    
    // Group alerts by state for better overview
    const alertsByState: Record<string, any[]> = {
      CRITICAL: [],
      WARNING: [],
      OK: [],
      UNKNOWN: []
    };
    
    if (response.data && response.data.items) {
      response.data.items.forEach((alert: any) => {
        const state = alert.Alert?.state || 'UNKNOWN';
        if (alertsByState[state]) {
          alertsByState[state].push(alert);
        }
      });
    }
    
    return {
      type: 'cluster-alerts',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      summary: {
        critical: alertsByState.CRITICAL.length,
        warning: alertsByState.WARNING.length,
        ok: alertsByState.OK.length,
        unknown: alertsByState.UNKNOWN.length
      },
      data: alertsByState
    };
  },

  'alerts-summary': async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/alerts`, { 
      format: 'groupedSummary',
      _: Date.now()
    });
    return {
      type: 'alerts-summary',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  'stale-configs': async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/host_components`, { 
      fields: 'HostRoles/component_name,HostRoles/host_name,HostRoles/service_name,HostRoles/state,HostRoles/stale_configs',
      'HostRoles/stale_configs': 'true',
      _: Date.now()
    });
    
    // Group by service for better organization
    const staleByService: Record<string, any[]> = {};
    if (response.data && response.data.items) {
      response.data.items.forEach((item: any) => {
        const serviceName = item.HostRoles?.service_name;
        if (serviceName) {
          if (!staleByService[serviceName]) {
            staleByService[serviceName] = [];
          }
          staleByService[serviceName].push(item);
        }
      });
    }
    
    return {
      type: 'stale-configurations',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      summary: {
        totalStaleComponents: response.data?.items?.length || 0,
        affectedServices: Object.keys(staleByService).length
      },
      data: staleByService
    };
  },

  service: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/services/${params.serviceName}`, { 
      fields: 'ServiceInfo/*,components/ServiceComponentInfo/*,components/host_components/HostRoles/state,components/host_components/HostRoles/host_name,components/host_components/HostRoles/stale_configs' 
    });
    return {
      type: 'service-details',
      clusterName: params.clusterName,
      serviceName: params.serviceName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  'service-components': async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/services/${params.serviceName}`, { 
      fields: 'components/ServiceComponentInfo/component_name,components/ServiceComponentInfo/category,components/ServiceComponentInfo/total_count,components/ServiceComponentInfo/started_count,components/host_components/HostRoles/host_name,components/host_components/HostRoles/state,components/host_components/HostRoles/stale_configs' 
    });
    return {
      type: 'service-components',
      clusterName: params.clusterName,
      serviceName: params.serviceName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  host: async (params) => {
    const response = await executeAmbariRequest('GET', `/hosts/${params.hostName}`, { 
      fields: 'Hosts/*,host_components/HostRoles/component_name,host_components/HostRoles/service_name,host_components/HostRoles/state,host_components/HostRoles/stale_configs' 
    });
    return {
      type: 'host-details',
      hostName: params.hostName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  'recent-requests': async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/requests`, { 
      fields: 'Requests/id,Requests/request_context,Requests/request_status,Requests/progress_percent,Requests/start_time,Requests/end_time,Requests/create_time',
      sortBy: 'Requests/id.desc',
      page_size: 20,
      _: Date.now()
    });
    return {
      type: 'recent-requests',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  },

  configurations: async (params) => {
    const response = await executeAmbariRequest('GET', `/clusters/${params.clusterName}/configurations`, { 
      fields: 'Config/type,Config/tag,Config/version,Config/service_name',
      _: Date.now()
    });
    return {
      type: 'cluster-configurations',
      clusterName: params.clusterName,
      timestamp: new Date().toISOString(),
      data: response.data
    };
  }
};
/* END GENAI */

// List resources handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: AMBARI_RESOURCES,
  };
});

// Read resource handler
server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
  const { uri } = request.params;

  try {
    // Parse the resource URI
    const parsedUri = parseResourceUri(uri);
    
    // Validate resource handler exists
    if (!resourceHandlers[parsedUri.type]) {
      throw new McpError(ErrorCode.InvalidRequest, `Unsupported resource type: ${parsedUri.type}`);
    }

    // Execute the resource handler
    const startTime = Date.now();
    const result = await resourceHandlers[parsedUri.type](parsedUri);
    const executionTime = Date.now() - startTime;

    // Create MCP-compliant resource response
    const response: ReadResourceResult = {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            uri: uri,
            executionTimeMs: executionTime,
            timestamp: new Date().toISOString(),
            ...result
          }, null, 2),
        }
      ],
    };

    return response;
  } catch (error) {
    // Handle MCP errors directly
    if (error instanceof McpError) {
      throw error;
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Resource access failed for ${uri}: ${errorMessage}`,
      { uri: uri, originalError: errorMessage }
    );
  }
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: AMBARI_TOOLS,
  };
});

// Call tool handler - MCP-compliant with proper return types
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  // Validate tool exists
  if (!toolExecutors[name]) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}. Available tools: ${Object.keys(toolExecutors).join(', ')}`);
  }

  // Validate tool is in AMBARI_TOOLS list
  const toolDefinition = AMBARI_TOOLS.find(tool => tool.name === name);
  if (!toolDefinition) {
    throw new McpError(ErrorCode.InternalError, `Tool ${name} executor exists but tool definition is missing`);
  }

  try {
    // Execute the tool with proper error handling
    const startTime = Date.now();
    const result = await toolExecutors[name](args || {});
    const executionTime = Date.now() - startTime;

    // Create MCP-compliant response with metadata
    const response: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tool: name,
            executionTimeMs: executionTime,
            timestamp: new Date().toISOString(),
            result: result
          }, null, 2),
        } as TextContent,
      ],
      isError: false,
    };

    return response;
  } catch (error) {
    // Handle MCP errors directly
    if (error instanceof McpError) {
      throw error;
    }

    // Handle Axios/HTTP errors with detailed information
    if (error && typeof error === 'object' && 'response' in error) {
      const httpError = error as any;
      throw new McpError(
        ErrorCode.InternalError,
        `Ambari API Error: ${httpError.message}`,
        {
          httpStatus: httpError.response?.status,
          httpStatusText: httpError.response?.statusText,
          url: httpError.config?.url,
          method: httpError.config?.method?.toUpperCase(),
        }
      );
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed for ${name}: ${errorMessage}`,
      { tool: name, originalError: errorMessage }
    );
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ambari MCP Server running on stdio');
  console.error(`Ambari URL: ${AMBARI_BASE_URL}`);
  console.error(`Available tools: ${AMBARI_TOOLS.length}`);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
/* END GENAI */
