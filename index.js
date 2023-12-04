const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const AWS = require('aws-sdk');
const sns = require("@pulumi/aws/sns");
const gcp = require("@pulumi/gcp");


// Create a pulumi.Config instance to access configuration settings
const config = new pulumi.Config();
// Use configuration settings or provide defaults
const vpcCidr = config.require("vpcCidr");
const cidr = config.require("cidr");
const cidrEnd = config.require("cidrEnd");
const vpcName = config.require("vpcName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
const publicRouteCidrBlock = config.require("publicRouteCidrBlock");

const vpc = new aws.ec2.Vpc(vpcName, {
  cidrBlock: vpcCidr,
  tags: {
    Name : vpcName
  }
});
const igw = new aws.ec2.InternetGateway(internetGatewayName, {
  vpcId: vpc.id,
});
const publicRouteTable = new aws.ec2.RouteTable(publicRouteTableName, {
  vpcId: vpc.id,
  // routes: [{ cidrBlock: publicRouteCidrBlock, gatewayId: igw.id }],
});
const publicRoute = new aws.ec2.Route(publicRouteTableName, {
  routeTableId: publicRouteTable.id,
  destinationCidrBlock: publicRouteCidrBlock,
  gatewayId: igw.id,
});
const privateRouteTable = new aws.ec2.RouteTable(privateRouteTableName, {
  vpcId: vpc.id,
});


const azs = aws.getAvailabilityZones();
const calculateCidrBlock = (index, subnetType) => {
  const subnetNumber = subnetType === "public" ? index * 2 : index * 2 + 1;
  return `${cidr}.${subnetNumber}.${cidrEnd}`;
};
const privateSubnets = []
const publicSubnets = []
azs.then((az) => {
  const maxSubnets = 6;
  let subnetCount = 0;
  az.names.forEach((zoneName, azIndex) => {
    if (subnetCount >= maxSubnets) return;
    let subnetsToCreate;
    // Determine the number of subnets to create based on the AZ count and index
    if (az.names.length <= 2) {
      subnetsToCreate = azIndex === 0 ? 2 : 2;
    } else {
      subnetsToCreate = 2;
    }
    for (let i = 0; i < subnetsToCreate; i++) {
      if (subnetCount >= maxSubnets) break;
      const subnetType = i % 2 === 0 ? "public" : "private";
      const routeTable =
        subnetType === "public" ? publicRouteTable : privateRouteTable;
      const subnetName = `${subnetType}-subnet-${subnetCount}`;
      const subnet = new aws.ec2.Subnet(subnetName, {
        vpcId: vpc.id,
        availabilityZone: zoneName,
        cidrBlock: calculateCidrBlock(subnetCount, subnetType),
        mapPublicIpOnLaunch: subnetType === "public",
      });
      new aws.ec2.RouteTableAssociation(`${subnetType}-rta-${subnetCount}`, {
        subnetId: subnet.id,
        routeTableId: routeTable.id,
      });
      if (subnetType === "private") {
        privateSubnets.push(subnet);
      } else {
        publicSubnets.push(subnet);
      }
      subnetCount++;
    }
  });
    // Create a Load Balancer Security Group
const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
  description: "Security group for the load balancer",
  vpcId: vpc.id,
  ingress: [
      {
          fromPort: 80,
          toPort: 80,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"],
      },
      {
          fromPort: 443,
          toPort: 443,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"],
      },
      

  ],
  egress: [
    {
      fromPort: 0, 
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});


// Create an EC2 security group for your application
const applicationSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
  ingress: [{
    fromPort: 22,
    toPort: 22,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  },
  {
    fromPort: 8080, 
    toPort: 8080,
    protocol: "tcp",
    securityGroups: [loadBalancerSecurityGroup.id], // Only accept traffic from the load balancer security group
  },
],
  egress: [
  {
    fromPort: 3306,      // Allow outbound traffic on port 3306
    toPort: 3306,        // Allow outbound traffic on port 3306
    protocol: "tcp",     // TCP protocol
    cidrBlocks: ["0.0.0.0/0"],  // Allow all destinations
  },
  {
    fromPort: 443, // HTTPS (CloudWatch Logs endpoint)
    toPort: 443,   // HTTPS (CloudWatch Logs endpoint)
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"], 
  },
],

  vpcId: vpc.id,
});

// //Security Group

const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-security-group", {
  description: "Security group for RDS instances",
  vpcId: vpc.id, 
});

// Create an ingress rule to allow traffic from your application's security group.
const ingressRule = new aws.ec2.SecurityGroupRule("rds-ingress-rule", {
  type: "ingress",
  fromPort: 3306, // Change to 5432 for PostgreSQL
  toPort: 3306, // Change to 5432 for PostgreSQL
  protocol: "tcp",
  sourceSecurityGroupId: applicationSecurityGroup.id,
  securityGroupId: rdsSecurityGroup.id,
});

// Restrict access to the instance from the internet.
const egressRule = new aws.ec2.SecurityGroupRule("rds-egress-rule", {
  type: "egress",
  fromPort: 0,
  toPort: 65535,
  protocol: "tcp",
  cidrBlocks: ["0.0.0.0/0"],
  securityGroupId: rdsSecurityGroup.id,
});

//Parameter group

// Define the custom parameter group name
const customParameterGroupName = 'new-custom-db-param-group-set';

const rds_db_param_group = new aws.rds.ParameterGroup(customParameterGroupName, {
  family: 'mysql8.0',
  description: 'Custom RDS parameter group for cross-AZ communication',
  });

// //RDS instance

const rds_private_subnet_1 = privateSubnets[0]
const rds_private_subnet_2 = privateSubnets[1]
const myDbSubnetGroup = new aws.rds.SubnetGroup("my-custom-rds-subnet-group", {
  subnetIds: [rds_private_subnet_1, rds_private_subnet_2],
});

const rds_instance = new aws.rds.Instance("csye6225", {
  allocatedStorage: 20,
  dbName: "csye6225",
  engine: "mysql",
  instanceClass: "db.t2.micro",
  parameterGroupName: rds_db_param_group.name,
  password: "abc12345",
  skipFinalSnapshot: true,
  username: "csye6225",
  dbSubnetGroupName: myDbSubnetGroup.name,
  vpcSecurityGroupIds: [rdsSecurityGroup.id],
  multiAz: false
  // availabilityZone: "us-east-1a",
});


const ec2Subnet = publicSubnets[0]
// Create an IAM role
const role = new aws.iam.Role("myIAMRole", {
  name: "my-iam-role", 
  assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
          {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                  Service: "ec2.amazonaws.com"
              }
          }
      ]
  })
});

// Create an IAM Policy
const policy = new aws.iam.Policy("examplePolicy", {
  policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "logs:DescribeLogStreams",
              "cloudwatch:PutMetricData",
              "cloudwatch:GetMetricData",
              "cloudwatch:GetMetricStatistics",
              "cloudwatch:ListMetrics",
              "ec2:DescribeTags",
              "sns:Publish",
              "ec2:DescribeLaunchTemplates"
               ],
          Resource: "*"
      }
      ],
  }),
});

// Attach the Policy to the Role
const rolePolicyAttachment = new aws.iam.RolePolicyAttachment("RolePolicyAttachment", {
  policyArn: policy.arn,
  role: role.name,
});
module.exports = { role };

// Create an IAM Instance Profile
const instanceProfile = new aws.iam.InstanceProfile("InstanceProfile", {
  role: role.name,
  name: "WebApp",
});
// ami-0f847f666817751e9

const snsTopic = new aws.sns.Topic("mySnsTopic");

// Create a Target Group for the ALB
const targetGroup = new aws.lb.TargetGroup("myTargetGroup", {
  port: 8080,
  protocol: "HTTP",
  targetType: "instance",
  healthCheck: {
    path: "/healthz",
    port: "8080",
    matcher: "200",
    protocol: "HTTP",
  },
  vpcId: vpc.id,
});

// Define Launch Template parameters
const launchTemplateName = "Applaunch";
// const amiId = "ami-05ea7e001691dd131/ami-07a3d1ee4987f0acf"; 
// const instanceType = "t2.micro";
// const keyName = "test"; 
// ami-05ea7e001691dd131
// Create Launch Template
const launchTemplate = new aws.ec2.LaunchTemplate("Applaunch", {
  imageId: "ami-0748cbb5bb04c884e",
    iamInstanceProfile: {
      arn: instanceProfile.arn,
    },
    instanceType: "t2.micro",   
    vpcId: vpc.id,
    rootBlockDevice: {
      volumeSize: 25,             // Root Volume Size
      volumeType: "gp2",         // Root Volume Type
      deleteOnTermination: true, // Ensure EBS volumes are terminated when the instance is terminated
    },
    keyName: "test",
    vpcSecurityGroupIds: [applicationSecurityGroup.id],
    userData: pulumi.interpolate`#!/bin/bash
    echo "NODE_ENV=production" >> /etc/environment
    endpoint="${rds_instance.endpoint}"
    echo "DB_HOST=\${endpoint%:*}" >> /etc/environment
    echo DB_USER=csye6225 >> /etc/environment
    echo DB_PASSWORD=abc12345 >> /etc/environment
    echo DB_NAME=csye6225 >> /etc/environment
    echo SNS_ARN=${snsTopic.arn} >> /etc/environment
    sudo systemctl start webapp
  `.apply(s => Buffer.from(s).toString('base64')),
     tags: {
      Name: "my-instance",
    }, 
});

// Create Auto Scaling Group
const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
  desiredCapacity: 1,
  maxSize: 3,
  minSize: 1,
  targetGroupArns: [targetGroup.arn], 
  launchTemplate: {
    id: launchTemplate.id,
      version: "$Latest",
  },
  vpcZoneIdentifiers: [...privateSubnets.map(subnet => subnet.id),
    ...publicSubnets.map(subnet => subnet.id),
],
  healthCheckType: "EC2",
  healthCheckGracePeriod: 300, // 300 seconds (5 minutes)
  forceDelete: true, // Delete the Auto Scaling group even if it has running instances.
  tags: [{
    key: "test",
    value: "webapp-instance",
    propagateAtLaunch: true,
}],
autoscalingGroupName: "webAppAutoScaling",
});

autoScalingGroup.id.apply(async (autoscalingGroupId) => {
  const scaleUpPolicy = new aws.autoscaling.Policy("scale-up-policy", {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: autoscalingGroupId,
    
  });
  const scaleDownPolicy = new aws.autoscaling.Policy("scale-down-policy", {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: autoscalingGroupId,
  });

  const highCpuAlarm = new aws.cloudwatch.MetricAlarm("high-cpu-alarm", {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2, 
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  period: 120,
  statistic: "Average",
  threshold: 5,
  alarmActions: [scaleUpPolicy.arn],
    dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
    },
  });

  const lowCpuAlarm = new aws.cloudwatch.MetricAlarm("low-cpu-alarm", {
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 2,
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  period: 120,
  statistic: "Average",
  threshold: 3,
  alarmActions: [scaleDownPolicy.arn],
    dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
    },
  });
});  

// Reference this security group in your load balancer configuration
const loadBalancer = new aws.lb.LoadBalancer("loadBalancer", {
  internal: false, // Set to true if internal, false if external
  securityGroups: [loadBalancerSecurityGroup.id],
  subnets: publicSubnets,
  loadBalancerType: "application",
});

const domainName = ""; 
const port = "8080"; 
const hostedZone = "Z004800715YBRB44PUMAI";
// Z004800715YBRB44PUMAI   #demo
// Z0020495E5MMQXTBZK11

const record = new aws.route53.Record("webapproutelink", {
  // name: domainName,
  name: "",
  type: "A",
  zoneId: hostedZone,
  aliases: [{
    name: loadBalancer.dnsName, 
    zoneId: loadBalancer.zoneId,
    evaluateTargetHealth: true, 
  }],

});

// Create a Google Cloud Storage Bucket
const bucket = new gcp.storage.Bucket("my-bucket-new", {
  location: "US",
});

// Create a Google Service Account
const serviceAccount = new gcp.serviceaccount.Account("my-service-account", {
  accountId: "my-service-account",
  displayName: "My Service Account",
});

const accessKey = new gcp.serviceaccount.Key("myAccessKey", {
    serviceAccountId: serviceAccount.accountId,
});
// const serviceAccountEmail = serviceAccount.email.apply(email => email);

const serviceAccountEmail = config.require("serviceAccountEmail");
const project = config.require("project");
 
// Grant permissions to the Service Account for the bucket
const bucketIAMBinding = new gcp.storage.BucketIAMBinding("bucketIamBinding", {
    bucket: bucket.name,
    role: "roles/storage.objectAdmin", // Role granting storage.objects.create permission
    members: [ `serviceAccount:${serviceAccountEmail}` ],
});

// Lambda Function
const lambdaRole = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: {
        Service: "lambda.amazonaws.com",
      },
    }],
  }),
});

// Attach the AWSLambdaBasicExecutionRole policy to the Lambda role
const executionRolePolicyAttachment = new aws.iam.RolePolicyAttachment("executionRolePolicyAttachment", {
  role: lambdaRole,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});

const nodeModulesLayer = new aws.lambda.LayerVersion("nodeModulesLayer", {
  layerName: "myNodeModulesLayer",
  code: new pulumi.asset.AssetArchive({
      "nodejs": new pulumi.asset.FileArchive("../serverless/nodejs")
  }),
  compatibleRuntimes: ["nodejs18.x"],
});
const lambdaFunc = new aws.lambda.Function("myLambdaFunction", {
  runtime: aws.lambda.Runtime.NodeJS18dX,
  layers: [nodeModulesLayer.arn],
  handler: "index.handler",
  role: lambdaRole.arn,
  code: new pulumi.asset.FileArchive("../serverless"),
  environment: {
    variables: {
      // Set environment variables for the Lambda function
      GCP_PROJECT: 'snappy-meridian-406523',
      GCP_BUCKET_NAME: bucket.name,
      GCP_SERVICE_ACCOUNT_KEY: accessKey.privateKey,
      MAILGUN_API_KEY: '53e60c46929e8bca7faa6f75f36c1783-30b58138-3d898205',
      MAILGUN_DOMAIN:'demo.csye6225sp.com'
    },
  },
});

// Create a subscription to the SNS topic that triggers the Lambda function
const lambdaSubscription = new aws.sns.TopicSubscription("lambdaSubscription", {
  topic: snsTopic.arn,
  protocol: "lambda",
  endpoint: lambdaFunc.arn,
});

// Attach a basic Lambda execution policy to the role
const lambdaPolicy = new aws.iam.RolePolicy("lambdaPolicy", {
  role: lambdaRole,
  policy: {
      Version: "2012-10-17",
      Statement: [{
          Action: "dynamodb:*",
          Effect: "Allow",
          Resource: "*"
      }],
  },
});

// Grant the SNS service permission to invoke the Lambda function
const lambdaPermission = new aws.lambda.Permission("lambdaPermission", {
  action: "lambda:InvokeFunction",
  function: lambdaFunc.name,
  principal: "sns.amazonaws.com",
  sourceArn: snsTopic.arn,
});

// Create a DynamoDB table for tracking emails

const emailDynamo = new aws.dynamodb.Table("emailTable", {
attributes: [
  { name: "Id", type: "S" },
],
hashKey: "Id",
billingMode: "PAY_PER_REQUEST",
name: "emailTable"
});

// HTTPS Listener for the Application Load Balancer
const webAppHttpsListener = new aws.lb.Listener("webAppHttpsListener", {
  loadBalancerArn: loadBalancer.arn,
  port: 443,
  protocol: "HTTPS",
  sslPolicy: "ELBSecurityPolicy-2016-08",
  certificateArn: "arn:aws:acm:us-east-1:143282580221:certificate/fd858497-7361-47a4-b569-11a9541a4ae3",
  defaultActions: [{
      type: "forward",
      targetGroupArn: targetGroup.arn,
  }],
});
});





