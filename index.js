const Azure = require('azure');
const MsRest = require('ms-rest-azure');
const SubscriptionClient = require('azure-asm-subscription');
const ResourceClient = require('azure-arm-resource');
const IoTHubClient = require('azure-arm-iothub');
const EventHubClient = require('azure-arm-eventhub');
const AppInsightsClient = require("azure-arm-appinsights");
const StorageManagementClient = require('azure-arm-storage');
const WebSiteManagementClient = require('azure-arm-website');
const inquirer = require('inquirer');
const uuidV4 = require('uuid/v4');

const IoTHubRegistry = require('azure-iothub').Registry;

let credentials = '';

let data = {
  subscriptionId: '',//'faab228d-df7a-4086-991e-e81c4659d41a',
  resourceGroup: '',//'zhiqing-sdk-test',
  location: '',
  useAI: false,
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
    connectionString: '',
    deviceConnectionString: '',
  },
  eventhub: {
    role: 'RootManageSharedAccessKey',
    endpointName: 'insights-logs-e2ediagnostics',
    connectionString: '',
  },
  ai: {
    instrumentationKey: '',
    applicationId: '',
    apiKey: '',
    name: '',
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
    connectionString: '',
    name: '',
  },
  webapp: {
    githubRepo: 'https://github.com/Azure-Samples/e2e-diagnostics-portal',
    githubBranch: 'master',
    envKey: {
      subscriptionId: 'SUBSCRIPTION_ID',
      resourceGroup: 'RESOURCE_GROUP_NAME',
      aiAppId: 'AI_APP_ID',
      aiApiKey: 'AI_API_KEY',
      aiName: 'AI_NAME',
      storageCs: 'STORAGE_CONNECTION_STRING',
    }
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
  let nameAnswers = await inquirer.prompt({
    type: 'input',
    name: 'name',
    message: "Input the resource group name. All the resources will be created in this group",
    default: () => 'e2e-diagnostics'
  });

  let answers = await inquirer.prompt({
    type: 'list',
    name: 'location',
    message: 'Choose the location of all provisioned resources',
    choices: data.availableLocationList,
  });
  data.location = answers.location;
  console.log();

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
        value: true
      },
      {
        name: 'Storage (It will create Storage account.)',
        value: false
      }
    ],
  });
  data.useAI = sourceAnswers.choice;
  console.log();

  let webappAnswers = await inquirer.prompt({
    type: 'list',
    name: 'webapp',
    message: 'A web portal will be provided to visualize diagnostic data. Choose how to deploy this portal',
    choices: [
      {
        name: 'Deploy on Azure Web app',
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

async function createIoTHub() {
  let nameAnswers = await inquirer.prompt({
    type: 'input',
    name: 'name',
    message: "Input the IoT Hub name",
    default: () => 'iothub' + data.suffix,
  });

  let skuAnswers = await inquirer.prompt({
    type: 'list',
    name: 'sku',
    message: 'Choose the pricing and scale tier of IoT Hub',
    choices: ['F1', 'S1', 'S2', 'S3'],
  });

  const hubDescription = {
    name: nameAnswers.name,
    location: data.location,
    subscriptionid: data.subscriptionId,
    resourcegroup: data.resourceGroup,
    sku: { name: skuAnswers.sku, capacity: 1 },
  };

  const client = new IoTHubClient(credentials, data.subscriptionId);

  console.log(`Creating IoT Hub ${hubDescription.name}...`);
  let result = await client.iotHubResource
    .createOrUpdate(data.resourceGroup, hubDescription.name, hubDescription);
  let { hostName } = result.properties;
  console.log(`IoT Hub created`);

  console.log(`Fetching connection string of IoT Hub...`);
  let keyResult = await client.iotHubResource.getKeysForKeyName(hubDescription.resourcegroup, hubDescription.name, data.iothub.role);
  data.iothub.connectionString = `HostName=${hostName};SharedAccessKeyName=${data.iothub.role};SharedAccessKey=${keyResult.primaryKey}`;
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
  data.iothub.deviceConnectionString = `HostName=${hostName};DeviceId=${deviceResult.deviceId};SharedAccessKey=${deviceResult.authentication.symmetricKey.primaryKey}`;
  console.log(`IoT Hub Device created\n`);

  // TODO: set sampling rate 
}

async function createEventHub() {
  const eventHubOptions = {
    location: data.location,
    subscriptionid: data.subscriptionId,
    resourcegroup: data.resourceGroup,
    sku: { name: 'Basic', capacity: 1 }, //Basic, Standard or Premium
  }
  let name = 'eventhub' + data.suffix;
  console.log(`Creating Event Hub ${name}...`);
  const client = new EventHubClient(credentials, data.subscriptionId);
  let result = await client.namespaces.createOrUpdate(data.resourceGroup, name, eventHubOptions);
  console.log(`Event Hub created`);

  console.log(`Fetching connection string of Event Hub...`);
  let keyResult = await client.namespaces.listKeys(eventHubOptions.resourcegroup, name, data.eventhub.role);
  data.eventhub.connectionString = keyResult.primaryConnectionString;
  console.log(`Connection string fetched\n`);
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
  console.log(`Application Insights created`);

  // TODO: fetch api key
  console.log(`Generating Api key for Application Insights ${appInsightsOptions.name}...`);
  let keyResult = await client.aPIKeys.create(data.resourceGroup, appInsightsOptions.name, apiKeyOptions);
  data.ai.apiKey = keyResult.apiKey;
  console.log(`Api key generated\n`);
}

async function createFunctionApp() {
  // const appServicePlanOptions = {
  //   appServicePlanName: 'zhiqing-sdk-service-plan',
  //   location: data.location,
  //   subscriptionid: data.subscriptionId,
  //   resourcegroup: data.resourceGroup,
  //   sku: {
  //     name: "S1" // F1,D1,B1,S1
  //   }
  // }

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
    isManualIntegration: true
  }

  const functionSiteName = 'function-container' + data.suffix;
  const functionAppName = 'function-app' + data.suffix;

  let client = new WebSiteManagementClient(credentials, data.subscriptionId);

  /* console.log(`Creating Service plan ${appServicePlanOptions.appServicePlanName}...`);
  
  let aspResult = await client.appServicePlans.createOrUpdate(data.resourceGroup, appServicePlanOptions.appServicePlanName, appServicePlanOptions);
  console.log(aspResult);
  data.serviceplan.name = aspResult.appServicePlanName;
  console.log(`Service plan created`); */

  console.log(`Creating Function site ${functionSiteName}...`);
  let functionSiteResult = await client.webApps.createOrUpdate(data.resourceGroup, functionSiteName, functionSiteOptions);
  console.log(`Function site created\n`);

  console.log(`Creating Function app ${functionAppName}...`);
  let functionAppResult = await client.webApps.createOrUpdateSourceControl(data.resourceGroup, functionSiteName, functionAppOptions);
  console.log(`Function app created\n`)
}

async function createStorage() {
  const storageOptions = {
    location: data.location,
    sku: { name: 'Standard_LRS' },
    kind: 'Storage',
  }
  let name = 'storage' + data.suffix;
  name = name.replace(/[^a-z0-9]/g,'');
  console.log(`Creating Storage account ${name}...`);
  const client = new StorageManagementClient(credentials, data.subscriptionId);
  let result = await client.storageAccounts.create(data.resourceGroup, name, storageOptions);
  data.storage.name = result.name;
  console.log(`Storage account created`);

  console.log(`Fetching connection string of Storage...`);
  let keyResult = await client.storageAccounts.listKeys(data.resourceGroup, name);
  data.storage.connectionString = `DefaultEndpointsProtocol=https;AccountName=${result.name};AccountKey=${keyResult.keys[0].value};EndpointSuffix=core.windows.net`;
  console.log(`Connection string fetched\n`);
}

async function createWebApp() {
  let appSettings;

  if (!data.ai.name || !data.ai.applicationId || !data.ai.apiKey) {
    throw new Error('Web app depends on Application insights information which is empty');
  }

  if (data.useAI) {
    appSettings = [
      {
        name: data.webapp.envKey.subscriptionId,
        value: data.subscriptionId,
      },
      {
        name: data.webapp.envKey.resourceGroup,
        value: data.resourceGroup,
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
        name: data.webapp.envKey.subscriptionId,
        value: data.subscriptionId,
      },
      {
        name: data.webapp.envKey.resourceGroup,
        value: data.resourceGroup,
      },
      {
        name: data.webapp.envKey.storageCs,
        value: data.storage.connectionString,
      },
    ]
  }
  const webAppOptions = {
    serverFarmId: '',
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

  console.log(`Visit portal in this link: ${'http://' + webAppResult.hostNames[0]}`);
}

async function showInstructionsToDeployWebapp() {
  console.log(`Here's the instructions to deploy web portal on your own server.\n`);
  console.log(`First you need to set some environement variables:\n`);
  console.log(`${data.webapp.envKey.subscriptionId} : ${data.subscriptionId}`);
  console.log(`${data.webapp.envKey.resourceGroup} : ${data.resourceGroup}`);
  if (data.useAI) {
    console.log(`${data.webapp.envKey.aiName} : ${data.ai.name}`);
    console.log(`${data.webapp.envKey.aiAppId} : ${data.ai.applicationId}`);
    console.log(`${data.webapp.envKey.aiApiKey} : ${data.ai.apiKey}`);
  } else {
    console.log(`${data.webapp.envKey.storageCs} : ${data.storage.connectionString}`);
  }
  console.log();
  console.log(`Open a new command window and execute following commands`);
  console.log(`git clone https://github.com/Azure-Samples/e2e-diagnostics-portal.git`);
  console.log(`cd e2e-diagnostics-portal`);
  console.log(`npm i`);
  console.log(`npm run deploy`);
}

async function doChoice1() {
  await createIoTHub();
  await createEventHub();
  await createApplicationInsights();
  await createStorage();
  await createFunctionApp();
  if (data.deployWebapp) {
    await createWebApp();
  } else {
    await showInstructionsToDeployWebapp();
  }
}

async function doChoice2() {
  await createIoTHub();
  await createStorage();
  if (data.deployWebapp) {
    await createWebApp();
  } else {
    await showInstructionsToDeployWebapp();
  }
}

async function run() {
  console.log(`*** Welcome to Happy Deploy of End to end diagnostics ***`);
  try {
    credentials = await login();
    await getSubscription();
    await createResourceGroup();
    await setOption();
    data.suffix = '-e2e-diag-' + uuidV4().substring(0, 4);
    if (data.useAI) {
      await doChoice1();
    } else {
      await doChoice2();
    }
    console.log(`\n\n*** All the deployment work successfully finished. ***\n`);
    console.log(`Use this device connection string to have a test: ${data.iothub.deviceConnectionString}`);
  }
  catch (e) {
    console.log('Something went error during deployment: ', e.message);
  }
}

run()