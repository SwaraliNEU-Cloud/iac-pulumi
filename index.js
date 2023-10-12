const pulumi = require("@pulumi/pulumi");

const aws = require("@pulumi/aws");

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

  return `${cidr}.${subnetNumber}.${cidrEnd}`; // Use backticks for template literals

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

      const subnetName = `${subnetType}-subnet-${subnetCount}`; // Use backticks

 

      const subnet = new aws.ec2.Subnet(subnetName, {

        vpcId: vpc.id,

        availabilityZone: zoneName,

        cidrBlock: calculateCidrBlock(subnetCount, subnetType),

        mapPublicIpOnLaunch: subnetType === "public",

      });

 

      new aws.ec2.RouteTableAssociation(`${subnetType}-rta-${subnetCount}`, {

        // Use backticks

        subnetId: subnet.id,

        routeTableId: routeTable.id,

      });

 

      subnetCount++;

    }

  });

});