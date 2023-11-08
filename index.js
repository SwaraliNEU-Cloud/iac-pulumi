const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
// const AWS = require('aws-sdk');

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


// Create an EC2 security group for your application
const applicationSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
  ingress: [{
    fromPort: 22,
    toPort: 22,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  }, {
    fromPort: 80,
    toPort: 80,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  }, {
    fromPort: 443,
    toPort: 443,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  },{
    fromPort: 8080, // Replace with the port your application uses
    toPort: 8080,   // Replace with the port your application uses
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  }
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
    cidrBlocks: ["0.0.0.0/0"], // Allow outbound traffic to the internet
  },
],

  vpcId: vpc.id,
});

// //Security Group

const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-security-group", {
  description: "Security group for RDS instances",
  vpcId: vpc.id, // Replace with your VPC ID
});

// Create an ingress rule to allow traffic from your application's security group.
const ingressRule = new aws.ec2.SecurityGroupRule("rds-ingress-rule", {
  type: "ingress",
  fromPort: 3306, // Change to 5432 for PostgreSQL
  toPort: 3306, // Change to 5432 for PostgreSQL
  protocol: "tcp",
  sourceSecurityGroupId: applicationSecurityGroup.id, // Replace with your app's security group ID
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



const domainName = ""; // Replace with your actual domain name
const port = "8080"; // Replace with your desired port

const hostedZone = "Z004800715YBRB44PUMAI"; // Replace with the Route 53 hosted zone ID

// Z004800715YBRB44PUMAI   #demo

// Z0020495E5MMQXTBZK11

// Create an IAM role
const role = new aws.iam.Role("myIAMRole", {
  name: "my-iam-role", // Replace with your desired name
  assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
          {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                  Service: "ec2.amazonaws.com" // or other trusted services
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
              "ec2:DescribeTags"
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
});

const ec2Instance = new aws.ec2.Instance("appEC2Instance", {
  ami: "ami-0f847f666817751e9", // Replace with your AMI ID
  instanceType: "t2.micro",   // Modify as needed
  // securityGroups: [applicationSecurityGroup.name],
  vpcId: vpc.id,
  // iamInstanceProfile: role.name,
  rootBlockDevice: {
    volumeSize: 25,             // Root Volume Size
    volumeType: "gp2",         // Root Volume Type
    deleteOnTermination: true, // Ensure EBS volumes are terminated when the instance is terminated

  },
  keyName: "test",
  vpcSecurityGroupIds: [applicationSecurityGroup.id],
  subnetId: ec2Subnet.id,
  iamInstanceProfile: instanceProfile.name,
  userData: pulumi.interpolate`
  #!/bin/bash
  echo "NODE_ENV=production" >> /etc/environment
  endpoint="${rds_instance.endpoint}"
  echo "DB_HOST=\${endpoint%:*}" >> /etc/environment
  echo DB_USER=csye6225 >> /etc/environment
  echo DB_PASSWORD=abc12345 >> /etc/environment
  echo DB_NAME=csye6225 >> /etc/environment
  sudo systemctl start webapp
`.apply(s => s.trim()),
   tags: {
    Name: "my-instance", // Set your desired instance name
  },

  });

  const record = new aws.route53.Record("webapproutelink", {
    name: domainName,
    type: "A",
    zoneId: hostedZone,
    ttl: 300,
    records: [ec2Instance.publicIp],
  });

// Export the instance profile name and role name
exports.roleName = role.name;
// Export values for reference
exports.applicationSecurityGroupId = applicationSecurityGroup.id;
exports.ec2InstanceId = ec2Instance.id;
exports.rdsSecurityGroupId = rdsSecurityGroup.id;
exports.ec2InstancePublicIp = ec2Instance.publicIp;

});


// sudo systemctl daemon-reload
//   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json
//   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a start
//   sudo systemctl enable webapp
