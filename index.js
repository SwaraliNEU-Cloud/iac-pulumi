const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
// const AWS = require('aws-sdk');
// const ec2 = new AWS.EC2({ region: 'us-east-1' });

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
      subnetCount++;
    }
  });

  const example = aws.ec2.getAmi({
    // executableUsers: ["admin"],
    filters: [
        {
            name: "name",
            values: ["webapp-ami-*"],
        },
        // {
        //     name: "root-device-type",
        //     values: ["ebs"],
        // },
        // {
        //     name: "virtualization-type",
        //     values: ["hvm"],
        // },
    ],
    mostRecent: true,
    // nameRegex: "^webapp-ami-\\d{3}",
    // owners: ["admin"],
    
});

const amiId = example.then(result => result.id);
  
  // ec2.describeImages(params, (err, data) => {
  //   if (err) console.log(err, err.stack);
  //   else {
  //     const ami = data.Images[0]; // Get the most recent matching AMI
  //     console.log(ami);
  //   }
  // });


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
  }],
});

// Create an EC2 instance
const ec2Instance = amiId.then(ami => new aws.ec2.Instance("appEC2Instance", {
  ami: ami, // Replace with your AMI ID
  instanceType: "t2.micro",   // Modify as needed
  securityGroups: [applicationSecurityGroup.name],
  rootBlockDevice: {
    volumeSize: 25,             // Root Volume Size
    volumeType: "gp2",         // Root Volume Type
    deleteOnTermination: true, // Ensure EBS volumes are terminated when the instance is terminated
  },
  keyName: "test",
  // Add other instance parameters here
}));

// Export values for reference
exports.applicationSecurityGroupId = applicationSecurityGroup.id;
exports.ec2InstanceId = ec2Instance.id;

});