#!/usr/bin/env node
const MsRest = require('ms-rest-azure');
const SubscriptionClient = require('azure-asm-subscription');
const ResourceClient = require('azure-arm-resource');
const IoTHubClient = require('azure-arm-iothub');
const MonitorManagementClient = require('azure-arm-monitor');
const EventHubClient = require('azure-arm-eventhub');
const AppInsightsClient = require("azure-arm-appinsights");
const StorageManagementClient = require('azure-arm-storage');
const WebSiteManagementClient = require('azure-arm-website');
const OperationalInsightsManagement = require("azure-arm-operationalinsights");
const inquirer = require('inquirer');
const uuidV4 = require('uuid/v4');
const colors = require('colors/safe');
const program = require('commander');

const IoTHubRegistry = require('azure-iothub').Registry;

let credentials = '';

let data = {
  subscriptionId: '',
  resourceGroup: '',
  iothubResourceGroup: '',
  location: '',
  choice: 0, // 0 Eventhub, 1 storage, 2 Log Analytics
  deployWebapp: false,
  suffix: '',
  availableLocationList: [
    "Australia East",
    "Australia Southeast",
    "Brazil South",
    "Canada Central",
    "Canada East",
    "Central India",
    "Central US",
    "East Asia",
    "East US",
    "East US 2",
    "Japan East",
    "Japan West",
    "North Europe",
    "South Central US",
    "South India",
    "Southeast Asia",
    "UK South",
    "UK West",
    "West Central US",
    "West Europe",
    "West India",
    "West US",
    "West US 2"
  ],
  iothub: {
    role: 'iothubowner',
    id: '',
    name: '',
    hostName: '',
    connectionString: '',
    deviceConnectionString: '',
    useNew: false,
  },
  eventhub: {
    role: 'RootManageSharedAccessKey',
    endpointName: 'insights-logs-e2ediagnostics',
    authorizationRuleId: '',
    connectionString: '',
  },
  ai: {
    instrumentationKey: '',
    applicationId: '',
    apiKey: '',
    name: '',
  },
  serviceplan: {
    id: '',
  },
  function: {
    envKey: {
      eventhubEndpoint: 'E2E_DIAGNOSTICS_EVENTHUB_ENDPOINT',
      aiInstrumentationKey: 'E2E_DIAGNOSTICS_AI_INSTRUMENTATION_KEY',
    },
    githubRepo: 'https://github.com/Azure-Samples/e2e-diagnostic-eventhub-ai-function',
    githubBranch: 'auto',
  },
  storage: {
    id: '',
    connectionString: '',
    name: '',
  },
  webapp: {
    githubRepo: 'https://github.com/Azure-Samples/e2e-diagnostics-portal',
    githubBranch: 'static',
    envKey: {
      subscriptionId: 'SUBSCRIPTION_ID',
      resourceGroup: 'RESOURCE_GROUP_NAME',
      iothub: 'IOTHUB_CONNECTION_STRING',
      aiAppId: 'AI_APP_ID',
      aiApiKey: 'AI_API_KEY',
      aiName: 'AI_NAME',
      storageCs: 'STORAGE_CONNECTION_STRING',
    }
  },
  oms: {
    id: '',
  }
}

async function login() {
  console.log(`Please login to Azure account at first`);
  return new Promise((resolve, reject) => {
    MsRest.interactiveLogin((err, credentials) => {
      if (err) {
        reject(err);
      }
      console.log(`Login successfully\n`);
      resolve(credentials);
    });
  });
}

async function getSubscription() {
  const client = new ResourceClient.SubscriptionClient(credentials);
  let result = await client.subscriptions.list();
  console.log(colors.white(' '));
  // choose subscriptions
  const inquirerOptions = [{
    type: 'list',
    name: 'subscription',
    message: 'Choose the subscription',
    choices: result.map(r => ({
      name: `${r.displayName} (${r.subscriptionId})`,
      value: r.subscriptionId,
    })),
  }];
  let answers = await inquirer.prompt(inquirerOptions);
  data.subscriptionId = answers.subscription;
}

async function createResourceGroup() {
  let iothubAnswers = await inquirer.prompt({
    type: 'list',
    name: 'choice',
    message: 'You can create a new IoT Hub or use existing one.',
    choices: [
      {
        name: 'Create a new IoT Hub',
        value: true
      },
      {
        name: 'Use existing IoT Hub(Then all resources will be created in the same location with IoT Hub)',
        value: false
      }
    ],
  });
  data.iothub.useNew = iothubAnswers.choice;

  if (!data.iothub.useNew) {
    await getExistingIoTHub();
  }

  let nameAnswers = await inquirer.prompt({
    type: 'input',
    name: 'name',
    message: "Input the resource group name. All the resources will be created in this group",
    default: () => 'e2e-diagnostics'
  });

  if (data.iothub.useNew) {
    let answers = await inquirer.prompt({
      type: 'list',
      name: 'location',
      message: 'Choose the location of all provisioned resources',
      choices: data.availableLocationList,
    });
    data.location = answers.location;
    console.log();
  }

  console.log(`Creating resource group ${nameAnswers.name} on location ${data.location}`);
  let client = new ResourceClient.ResourceManagementClient(credentials, data.subscriptionId);

  let result = await client.resourceGroups.createOrUpdate(nameAnswers.name, { location: data.location });
  data.resourceGroup = result.name;
  console.log(`Resource group created\n`);
}

async function setOption() {
  let sourceAnswers = await inquirer.prompt({
    type: 'list',
    name: 'choice',
    message: 'Choose the destination of diagnostic logs',
    choices: [
      {
        name: 'Event Hub (Recommended. You can use SQL-like query to find your diagnostic logs easily. It will create Event Hub, Application Insights and Azure Function.)',
        value: 0
      },
      {
        name: 'Storage (It will create Storage account.)',
        value: 1
      },
      {
        name: 'Log Analytics (It will create Log Analytics and you need to use SQL-like query to do visualization)',
        value: 2
      }
    ],
  });
  data.choice = sourceAnswers.choice;
  console.log();

  if (data.choice === 0 || data.choice === 1) {
    let webappAnswers = await inquirer.prompt({
      type: 'list',
      name: 'webapp',
      message: 'A web portal will be provided to visualize diagnostic data. Choose how to deploy this portal',
      choices: [
        {
          name: 'Deploy on Azure Web app(Which will need less manual work)',
          value: true
        },
        {
          name: 'Deploy on your own server',
          value: false
        }
      ],
    });
    data.deployWebapp = webappAnswers.webapp;
    console.log();
  }
}

async function getExistingIoTHub() {
  const client = new IoTHubClient(credentials, data.subscriptionId);
  let result = await client.iotHubResource.listBySubscription();

  // choose iothub
  const inquirerOptions = [{
    type: 'list',
    name: 'iothub',
    message: 'Choose the IoT Hub',
    choices: result.map(r => ({
      name: `${r.name} (in ${r.location})`,
      value: r,
    })),
  }];
  let answers = await inquirer.prompt(inquirerOptions);
  data.iothub.name = answers.iothub.name;
  data.iothub.id = answers.iothub.id;
  data.iothub.hostName = answers.iothub.properties.hostName;
  data.location = answers.iothub.location;
  data.iothubResourceGroup = answers.iothub.resourcegroup;
}

async function createIoTHub() {
  let nameAnswers, skuAnswers, hubDescription;
  if (data.iothub.useNew) {
    nameAnswers = await inquirer.prompt({
      type: 'input',
      name: 'name',
      message: "Input the IoT Hub name",
      default: () => 'iothub' + data.suffix,
    });

    skuAnswers = await inquirer.prompt({
      type: 'list',
      name: 'sku',
      message: 'Choose the pricing and scale tier of IoT Hub',
      choices: ['F1', 'S1', 'S2', 'S3'],
    });

    hubDescription = {
      name: nameAnswers.name,
      location: data.location,
      subscriptionid: data.subscriptionId,
      resourcegroup: data.resourceGroup,
      sku: { name: skuAnswers.sku, capacity: 1 },
    };
  }

  let samplingRateAnswers = await inquirer.prompt({
    type: 'input',
    name: 'rate',
    message: "Set the diagnostic sampling rate",
    default: () => 100,
  });

  const client = new IoTHubClient(credentials, data.subscriptionId);

  console.log(colors.green.bold(`\nProvision work start, please wait...\n`));

  let result, hostName;
  if (data.iothub.useNew) {
    console.log(`Creating IoT Hub ${hubDescription.name}...`);
    result = await client.iotHubResource
      .createOrUpdate(data.resourceGroup, hubDescription.name, hubDescription);
    hostName = result.properties.hostName;
    data.iothub.id = result.id;
    data.iothub.name = result.name;
    console.log(`IoT Hub created\n`);
  }

  console.log(`Fetching connection string of IoT Hub...`);
  let keyResult = await client.iotHubResource.getKeysForKeyName(data.iothub.useNew ? data.resourceGroup : data.iothubResourceGroup, data.iothub.name, data.iothub.role);
  data.iothub.connectionString = `HostName=${data.iothub.useNew ? hostName : data.iothub.hostName};SharedAccessKeyName=${data.iothub.role};SharedAccessKey=${keyResult.primaryKey}`;
  console.log(`Connection string fetched\n`);

  const deviceOptions = {
    deviceId: 'e2e-diag',
    status: 'enabled'
  };

  console.log(`Creating IoT Hub device ${deviceOptions.deviceId}...`);
  let registry = IoTHubRegistry.fromConnectionString(data.iothub.connectionString);
  let deviceResult = await new Promise((resolve, reject) => {
    registry.create(deviceOptions, (err, result) => {
      if (err) {
        reject(err);
      }
      resolve(result);
    })
  });
  data.iothub.deviceConnectionString = `HostName=${data.iothub.useNew ? hostName : data.iothub.hostName};DeviceId=${deviceResult.deviceId};SharedAccessKey=${deviceResult.authentication.symmetricKey.primaryKey}`;
  console.log(`IoT Hub Device created\n`);

  console.log(`Setting device diagnostic sampling rate to ${samplingRateAnswers.rate}...`);
  await new Promise((resolve, reject) => {
    registry.updateTwin(deviceOptions.deviceId, { properties: { desired: { __e2e_diag_sample_rate: parseInt(samplingRateAnswers.rate) } } }, '*', (err, result) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
  console.log(`Sampling rate set\n\n-------------------------------------------------------------------\n`);
}

async function createEventHub() {
  const eventHubOptions = {
    location: data.location,
    subscriptionid: data.subscriptionId,
    resourcegroup: data.resourceGroup,
    sku: { name: 'Basic', capacity: 1 }, //Basic, Standard or Premium
  }
  let name = 'eventhub' + data.suffix;
  console.log(`Creating Event Hub namespace ${name}...`);
  const client = new EventHubClient(credentials, data.subscriptionId);
  let result = await client.namespaces.createOrUpdate(data.resourceGroup, name, eventHubOptions);

  let authorizationResult = await client.namespaces.getAuthorizationRule(data.resourceGroup, name, 'RootManageSharedAccessKey');
  data.eventhub.authorizationRuleId = authorizationResult.id;

  console.log(`Event Hub namespace created\n`);

  console.log(`Creating Event Hub insights-logs-e2ediagnostics...`);
  let diagResult = await client.eventHubs.createOrUpdate(data.resourceGroup, result.name, 'insights-logs-e2ediagnostics', { messageRetentionInDays: 1 });
  console.log(`Event Hub created\n`);

  console.log(`Fetching connection string of Event Hub...`);
  let keyResult = await client.namespaces.listKeys(eventHubOptions.resourcegroup, name, data.eventhub.role);
  data.eventhub.connectionString = keyResult.primaryConnectionString;
  console.log(`Connection string fetched\n\n-------------------------------------------------------------------\n`);
}

async function createApplicationInsights() {
  const appInsightsOptions = {
    name: 'application-insights' + data.suffix,
    kind: 'store',
    applicationType: 'other',
    location: 'East US',
    subscriptionid: data.subscriptionId,
    resourcegroup: data.resourceGroup,
  }
  const apiKeyOptions = {
    name: 'e2e-diagnostics',
    linkedReadProperties: [`/subscriptions/${data.subscriptionId}/resourceGroups/${data.resourceGroup}/providers/microsoft.insights/components/${appInsightsOptions.name}/api`],
    linkedWriteProperties: [],
  };

  console.log(`Creating Application Insights ${appInsightsOptions.name}...`);
  const client = new AppInsightsClient(credentials, data.subscriptionId);
  let result = await client.components.createOrUpdate(data.resourceGroup, appInsightsOptions.name, appInsightsOptions);
  data.ai.applicationId = result.appId;
  data.ai.name = result.name;
  data.ai.instrumentationKey = result.instrumentationKey;
  console.log(`Application Insights created\n`);

  // TODO: fetch api key
  console.log(`Generating Api key for Application Insights ${appInsightsOptions.name}...`);
  let keyResult = await client.aPIKeys.create(data.resourceGroup, appInsightsOptions.name, apiKeyOptions);
  data.ai.apiKey = keyResult.apiKey;
  console.log(`Api key generated\n\n-------------------------------------------------------------------\n`);
}

async function createFunctionApp() {
  const appServicePlanOptions = {
    appServicePlanName: 'function-server-plan' + data.suffix,
    location: data.location,
    sku: {
      name: "B1" // F1,D1,B1,S1
    }
  }

  if (!data.eventhub.connectionString) {
    throw new Error('Function app depends on Event Hub connection string which is empty');
  }

  if (!data.ai.instrumentationKey) {
    throw new Error('Function app depends on AI instrumentation key which is empty');
  }

  const functionSiteOptions = {
    serverFarmId: '',
    kind: 'functionapp',
    location: data.location,
    siteConfig: {
      alwaysOn: true,
      appSettings: [
        {
          name: 'AzureWebJobsDashboard',
          value: data.storage.connectionString,
        },
        {
          name: 'AzureWebJobsStorage',
          value: data.storage.connectionString,
        },
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING',
          value: data.storage.connectionString,
        },
        {
          name: 'WEBSITE_CONTENTSHARE',
          value: data.storage.name,
        },
        {
          name: data.function.envKey.eventhubEndpoint,
          value: data.eventhub.connectionString,
        },
        {
          name: data.function.envKey.aiInstrumentationKey,
          value: data.ai.instrumentationKey,
        },
      ],
    },
  }

  const functionAppOptions = {
    repoUrl: data.function.githubRepo,
    branch: data.function.githubBranch,
    isManualIntegration: true,
  }

  const functionSiteName = 'function-container' + data.suffix;
  const functionAppName = 'function-app' + data.suffix;

  let client = new WebSiteManagementClient(credentials, data.subscriptionId);

  console.log(`Creating Service plan ${appServicePlanOptions.appServicePlanName}...`);

  let aspResult = await client.appServicePlans.createOrUpdate(data.resourceGroup, appServicePlanOptions.appServicePlanName, appServicePlanOptions);
  data.serviceplan.id = aspResult.id;
  functionSiteOptions.serverFarmId = aspResult.id; //"/subscriptions/{subscriptionID}/resourceGroups/{groupName}/providers/Microsoft.Web/serverfarms/{appServicePlanName}".
  console.log(`Service plan created\n`);

  console.log(`Creating Function site ${functionSiteName}...`);
  let functionSiteResult = await client.webApps.createOrUpdate(data.resourceGroup, functionSiteName, functionSiteOptions);
  console.log(`Function site created\n`);

  console.log(`Creating Function app ${functionAppName}...`);
  let functionAppResult = await client.webApps.createOrUpdateSourceControl(data.resourceGroup, functionSiteName, functionAppOptions);
  // When deployed function app, it will not consume Event Hub data.(Don't know why). 
  let restartResult = await client.webApps.restart(data.resourceGroup, functionSiteName);
  console.log(`Function app created\n\n-------------------------------------------------------------------\n`)
}

async function createStorage() {
  const storageOptions = {
    location: data.location,
    sku: { name: 'Standard_LRS' },
    kind: 'Storage',
  }
  let name = 'storage' + data.suffix;
  name = name.replace(/[^a-z0-9]/g, '');
  console.log(`Creating Storage account ${name}...`);
  const client = new StorageManagementClient(credentials, data.subscriptionId);
  let result = await client.storageAccounts.create(data.resourceGroup, name, storageOptions);
  data.storage.name = result.name;
  data.storage.id = result.id;
  console.log(`Storage account created\n`);

  console.log(`Fetching connection string of Storage...`);
  let keyResult = await client.storageAccounts.listKeys(data.resourceGroup, name);
  data.storage.connectionString = `DefaultEndpointsProtocol=https;AccountName=${result.name};AccountKey=${keyResult.keys[0].value};EndpointSuffix=core.windows.net`;
  console.log(`Connection string fetched\n\n-------------------------------------------------------------------\n`);
}

async function createLogAnalytics() {
  const client = new OperationalInsightsManagement(credentials, data.subscriptionId);

  let omsOptions = {
    sku: { name: 'Free' },
    location: 'eastus', // Log analytics doesn't need to be same location with iot hub
  }

  let name = 'oms' + data.suffix;
  console.log(`Creating Log Analytics (OMS workspace) ${name}...`);
  let result = await client.workspaces.createOrUpdate(data.resourceGroup, name, omsOptions);
  data.oms.id = result.id;
  console.log(`Log Analytics (OMS workspace) created\n\n-------------------------------------------------------------------\n`);
}

async function setIoTHubDiagnostics() {
  let client = new MonitorManagementClient(credentials, data.subscriptionId);
  let diagnosticOptions = {
    logs: [{
      category: 'E2EDiagnostics',
      enabled: true,
    }]
  }

  if (data.choice === 0) {
    diagnosticOptions.eventHubAuthorizationRuleId = data.eventhub.authorizationRuleId;
  } else if (data.choice === 1) {
    diagnosticOptions.storageAccountId = data.storage.id;
  } else {
    diagnosticOptions.workspaceId = data.oms.id;
  }
  console.log(`Setting the IoT Hub diagnostics settings...`);
  let result = await client.diagnosticSettingsOperations.createOrUpdate(data.iothub.id, diagnosticOptions, 'e2e-diag');
  console.log(`IoT Hub diagnostics settings set\n\n-------------------------------------------------------------------\n`);
}

async function createWebApp() {
  let appSettings;

  if (data.choice === 0) {
    if (!data.ai.name || !data.ai.applicationId || !data.ai.apiKey) {
      throw new Error('Web app depends on Application insights information which is empty');
    }
  } else {
    if (!data.storage.connectionString) {
      throw new Error('Web app depends on Storage information which is empty');
    }
  }

  if (data.choice === 0) {
    appSettings = [
      {
        name: 'WEBSITE_NODE_DEFAULT_VERSION',
        value: '6.9.1',
      },
      {
        name: data.webapp.envKey.subscriptionId,
        value: data.subscriptionId,
      },
      {
        name: data.webapp.envKey.resourceGroup,
        value: data.resourceGroup,
      },
      {
        name: data.webapp.envKey.iothub,
        value: data.iothub.connectionString,
      },
      {
        name: data.webapp.envKey.aiName,
        value: data.ai.name,
      },
      {
        name: data.webapp.envKey.aiAppId,
        value: data.ai.applicationId,
      },
      {
        name: data.webapp.envKey.aiApiKey,
        value: data.ai.apiKey,
      },
    ]
  } else {
    appSettings = [
      {
        name: 'WEBSITE_NODE_DEFAULT_VERSION',
        value: '6.9.1',
      },
      {
        name: data.webapp.envKey.subscriptionId,
        value: data.subscriptionId,
      },
      {
        name: data.webapp.envKey.resourceGroup,
        value: data.resourceGroup,
      },
      {
        name: data.webapp.envKey.iothub,
        value: data.iothub.connectionString,
      },
      {
        name: data.webapp.envKey.storageCs,
        value: data.storage.connectionString,
      },
    ]
  }
  const webAppOptions = {
    serverFarmId: data.serviceplan.id,
    location: data.location,
    siteConfig: {
      appSettings,
    },
  }

  const deployOptions = {
    repoUrl: data.webapp.githubRepo,
    branch: data.webapp.githubBranch,
    isManualIntegration: true
  }

  const webAppName = 'portal' + data.suffix;

  let client = new WebSiteManagementClient(credentials, data.subscriptionId);
  console.log(`Creating Web app ${webAppName}...`);
  let webAppResult = await client.webApps.createOrUpdate(data.resourceGroup, webAppName, webAppOptions);
  console.log(`Web app created\n`);

  console.log(`Sync E2E portal to web app ${webAppName}...`);
  let deployResult = await client.webApps.createOrUpdateSourceControl(data.resourceGroup, webAppName, deployOptions);
  console.log(`E2E portal deployed\n`)

  console.log(`Visit portal in this link: ${colors.green.bold.underline('http://' + webAppResult.hostNames[0])}\n\n-------------------------------------------------------------------\n`);
}

async function showInstructionsToDeployWebapp() {
  console.log(`Here's the instructions to deploy web portal on your own server.\n`);
  console.log(`First you need to set some environement variables:\n\n-------------------------------------------------------------------\n`);
  console.log(`${data.webapp.envKey.subscriptionId} : ${data.subscriptionId}\n`);
  console.log(`${data.webapp.envKey.resourceGroup} : ${data.resourceGroup}\n`);
  console.log(`${data.webapp.envKey.iothub} : ${data.iothub.connectionString}\n`);
  if (data.choice === 0) {
    console.log(`${data.webapp.envKey.aiName} : ${data.ai.name}\n`);
    console.log(`${data.webapp.envKey.aiAppId} : ${data.ai.applicationId}\n`);
    console.log(`${data.webapp.envKey.aiApiKey} : ${data.ai.apiKey}\n`);
  } else {
    console.log(`${data.webapp.envKey.storageCs} : ${data.storage.connectionString}\n`);
  }
  console.log();
  console.log(`Then you need to set one more environment variable to specify the port which the portal running on`);
  console.log(`PORT : <THE_PORT_OF_PORTAL>`);
  console.log(`Please notice that if you use a lower port like 80, then you probably need administrator/root privilege. On Windows system, 80 is likely to be occupied by IIS service. Try using port larger than 1024 if you meet problem.`);
  console.log();
  console.log(`Open a new command window and execute following commands`);
  console.log(`git clone https://github.com/Azure-Samples/e2e-diagnostics-portal.git`);
  console.log(`cd e2e-diagnostics-portal`);
  console.log(`npm i`);
  console.log(`npm run deploy`);
}

async function doChoice0() {
  await createIoTHub();
  await createEventHub();
  await createApplicationInsights();
  await createStorage();
  await setIoTHubDiagnostics();
  await createFunctionApp();
  if (data.deployWebapp) {
    await createWebApp();
  }
}

async function doChoice1() {
  await createIoTHub();
  await createStorage();
  await setIoTHubDiagnostics();
  if (data.deployWebapp) {
    await createWebApp();
  }
}

async function doChoice2() {
  await createIoTHub();
  await createLogAnalytics();
  await setIoTHubDiagnostics();
}

async function run() {
  console.log(colors.green.bold(`*** Welcome to Happy Deploy of End to end diagnostics ***\nThis tool would help you create necessary resources for end to end diagnostics.\nIf you would like to know what will be created, visit this document: ${colors.underline('https://github.com/michaeljqzq/happy-deploy')}\n`));
  try {
    credentials = await login();
    await getSubscription();
    await createResourceGroup();
    await setOption();
    data.suffix = '-e2e-diag-' + uuidV4().substring(0, 4);
    if (data.choice === 0) {
      await doChoice0();
    } else if (data.choice === 1) {
      await doChoice1();
    } else {
      await doChoice2();
    }
    console.log(colors.green.bold(`\n\n-------------------------------------------------------------------\n*** All the deployment work successfully finished. ***\n`));
    console.log(`Use this device connection string to have a test: ${colors.green.bold(data.iothub.deviceConnectionString)}\n`);

    if (!data.deployWebapp && data.choice !== 2) {
      await showInstructionsToDeployWebapp();
    }
  }
  catch (e) {
    console.log(colors.red.bold('Something went error during deployment: ', e.message));
  }
}

program
  .version('1.0.1')
  .description('This tool would help you create necessary resources for end to end diagnostics.')
// .option('-n, --name <name>', 'your name', 'GK')
// .option('-a, --age <age>', 'your age', '22')
// .option('-e, --enjoy [enjoy]')
program.parse(process.argv);
run();



// async function test() {
//   credentials = await login();
//   let s = "abc";
//   data.choice = 2;
//   data.eventhub.connectionString = s;
//   data.ai.instrumentationKey = s;
//   data.storage.connectionString = '';
//   data.storage.name = '';
//   data.subscriptionId = "0d0575c0-0b3f-458a-a1a7-7a618a596892";
//   data.resourceGroup = "zhiqing-auto-3"
//   data.location = "East US"
//   data.suffix = '-e2e-diag-' + uuidV4().substring(0, 4);

//   await createLogAnalytics();
// }

// test();