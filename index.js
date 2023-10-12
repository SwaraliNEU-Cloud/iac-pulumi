const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const vpc = new aws.ec2.Vpc("my-vpc", {
    cidrBlock: "10.0.0.0/16",
});

const igw = new aws.ec2.InternetGateway("my-igw", {
    vpcId: vpc.id,
});

const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
    vpcId: vpc.id,
    routes: [
        { cidrBlock: "0.0.0.0/0", gatewayId: igw.id },
    ],
});

const privateRouteTable = new aws.ec2.RouteTable("private-route-table", {
    vpcId: vpc.id,
});

const azs = aws.getAvailabilityZones();

const calculateCidrBlock = (index, subnetType) => {
    const subnetNumber = subnetType === "public" ? index * 2 : index * 2 + 1;
    return `10.0.${subnetNumber}.0/24`;
};

azs.then(az => {
    const maxSubnets = 6;
    let subnetCount = 0;
    
    az.names.forEach((zoneName, azIndex) => {
        if (subnetCount >= maxSubnets) return;

        let subnetsToCreate;

        // Determine the number of subnets to create based on the AZ count and index
        if (az.names.length <= 2) {
            subnetsToCreate = azIndex === 0 ? 4 : 2;
        } else {
            subnetsToCreate = 2;
        }

        for (let i = 0; i < subnetsToCreate; i++) {
            if (subnetCount >= maxSubnets) break;

            const subnetType = i % 2 === 0 ? "public" : "private";
            const routeTable = subnetType === "public" ? publicRouteTable : privateRouteTable;
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
});