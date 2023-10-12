# iac-pulumi
Assignment 4


# Pulumi AWS VPC and Internet Gateway Example

This is a Pulumi project that demonstrates how to create an Amazon Virtual Private Cloud (VPC) and attach an Internet Gateway using the Pulumi infrastructure-as-code framework. The equivalent AWS JavaScript SDK code is also provided for reference.

## Prerequisites

Before you begin, ensure you have the following prerequisites:

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- AWS account with appropriate credentials configured

## Getting Started

1. Clone this repository:

   ```bash
   git clone https://github.com/yourusername/pulumi-aws-vpc-ig.git
   cd pulumi-aws-vpc-ig

   pulumi config set aws:region us-east-1  # Set your desired region
   
   aws configure  #Configure your stack credentials

   pulumi up
