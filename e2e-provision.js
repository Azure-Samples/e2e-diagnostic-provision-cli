#!/usr/bin/env node
const MsRest = require('ms-rest-azure');
const ResourceClient = require('azure-arm-resource');
const IoTHubClient = require('azure-arm-iothub');
const MonitorManagementClient = require('azure-arm-monitor');
const EventHubClient = require('azure-arm-eventhub');
const AppInsightsClient = require("azure-arm-appinsights");
const StorageManagementClient = require('azure-arm-storage');
const WebSiteManagementClient = require('azure-arm-website');
const inquirer = require('inquirer');
const uuidV4 = require('uuid/v4');
const colors = require('colors/safe');
const program = require('commander');

const IoTHubRegistry = require('azure-iothub').Registry;

const defaultEventHubName4Log = 'insights-logs-e2ediagnostics';

let credentials = '';

let data = {
  subscriptionId: '',
  resourceGroup: '',
  iothubResourceGroup: '',
  location: '',
  choice: 0, // 0 Eventhub, 1 storage, 2 Log Analytics
  suffix: '',
  currentStep: 1,
  overallSteps: 1,
  availableLocationList: [
    "North Europe",
    "Southeast Asia",
    "West US 2",
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
    endpointName: defaultEventHubName4Log,
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
    githubBranch: 'master',
  },
  storage: {
    id: '',
    connectionString: '',
    name: '',
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
    default: () => 'dis-tracing' + uuidV4().substring(0, 4)
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
  data.overallSteps = 6;
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
  
  if(!["westus2", "Southeast Asia","northeurope"].includes(data.location)) {
    throw new Error(`Now distributed tracing is only support in these locations: [${data.availableLocationList.join(", ")}], please re-run the cli and try again.`);
  }

  data.iothubResourceGroup = answers.iothub.resourcegroup;
}

function isValidSamplingRate(value) {
  if (value !== undefined) {
    value = value.toString().trim();
    if (!value) {
      return false;
    }
    const containsOnlyNumber = /^\d+$/.test(value);
    const num = parseFloat(value);
    if (!containsOnlyNumber || !Number.isInteger(num) || num < 0 || num > 100) {
      return false;
    }
    return true;
  } else {
    return false;
  }
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

  let samplingRateAnswers;
  while (true) {
    samplingRateAnswers = await inquirer.prompt({
      type: 'input',
      name: 'rate',
      message: "Set the distributed tracing sampling rate, between [0, 100]",
      default: () => 100,
    });
    if (isValidSamplingRate(samplingRateAnswers.rate)) {
      break;
    }
  }

  const client = new IoTHubClient(credentials, data.subscriptionId);

  console.log(colors.green.bold(`\nProvision work start, it will need about 10 minutes, please wait...\n`));

  let result, hostName;
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
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
    deviceId: 'distributed-tracing-device',
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

  console.log(`Setting device distributed tracing sampling rate to ${samplingRateAnswers.rate}...`);
  await new Promise((resolve, reject) => {
    registry.updateTwin(deviceOptions.deviceId, { properties: { desired: { "azureiot*com^dtracing^1": {"sampling_mode": 1, "sampling_rate": parseInt(samplingRateAnswers.rate) } } } }, '*', (err, result) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
  console.log(`Sampling rate set\n\n-------------------------------------------------------------------\n`);
}

async function createEventHub() {
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
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

  console.log(`Creating Event Hub ${defaultEventHubName4Log}...`);
  let diagResult = await client.eventHubs.createOrUpdate(data.resourceGroup, result.name, defaultEventHubName4Log, { messageRetentionInDays: 1 });
  console.log(`Event Hub created\n`);

  console.log(`Fetching connection string of Event Hub...`);
  let keyResult = await client.namespaces.listKeys(eventHubOptions.resourcegroup, name, data.eventhub.role);
  data.eventhub.connectionString = keyResult.primaryConnectionString;
  console.log(`Connection string fetched\n\n-------------------------------------------------------------------\n`);
}

async function createApplicationInsights() {
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
  const appInsightsOptions = {
    name: 'application-insights' + data.suffix,
    kind: 'web',
    applicationType: 'other',
    location: 'East US',
    subscriptionid: data.subscriptionId,
    resourcegroup: data.resourceGroup,
  }
  const apiKeyOptions = {
    name: 'distributed-tracing',
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
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
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
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
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

async function setIoTHubDiagnostics() {
  console.log(`[Step ${data.currentStep++}/${data.overallSteps}]\n`);
  let client = new MonitorManagementClient(credentials, data.subscriptionId);
  let diagnosticOptions = {
    logs: [{
      category: 'DistributedTracing',
      enabled: true,
    },
    {
      category: 'Connections',
      enabled: true,
    }]
  }

  if (data.choice === 0) {
    diagnosticOptions.eventHubAuthorizationRuleId = data.eventhub.authorizationRuleId;
    diagnosticOptions.eventHubName = defaultEventHubName4Log;
  }

  console.log(`Setting the IoT Hub distributed tracing settings...`);
  let result = await client.diagnosticSettingsOperations.createOrUpdate(data.iothub.id, diagnosticOptions, 'distributed-tracing');
  console.log(`IoT Hub distributed tracing settings set\n\n-------------------------------------------------------------------\n`);
}

async function doChoice0() {
  await createIoTHub();
  await createEventHub();
  await createApplicationInsights();
  await createStorage();
  await setIoTHubDiagnostics();
  await createFunctionApp();
}

async function run() {
  console.log(colors.green.bold(`*** Welcome to Azure IoT distributed tracing provision CLI ***\nThis tool would help you create necessary resources for distributed tracing.\nIf you would like to know what will be created, visit this document: ${colors.underline('https://github.com/Azure-Samples/e2e-diagnostic-provision-cli')}\n`));
  try {
    credentials = await login();
    await getSubscription();
    await createResourceGroup();
    await setOption();
    data.suffix = '-dis-tracing' + uuidV4().substring(0, 4);

    await doChoice0();

    console.log(colors.green.bold(`\n-------------------------------------------------------------------\n\n*** All the deployment work successfully finished. ***\n`));
    console.log(`Use this device connection string to have a test: ${colors.green.bold(data.iothub.deviceConnectionString)}\n`);
  }
  catch (e) {
    console.log(colors.red.bold('Something went error during deployment: '));
    console.log(e);
  }
}

program
  .version('2.0.3')
  .description('This tool would help you create necessary resources for Azure IoT distributed tracing.')
program.parse(process.argv);
run();