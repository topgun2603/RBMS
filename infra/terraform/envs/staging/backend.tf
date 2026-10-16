# Remote state: S3 + locking. Create the bucket and table once with infra/terraform/bootstrap, then uncomment this
# block, fill in the bucket name and run `terraform init` (or `terraform init -migrate-state` if you already applied
# with local state). Until then, state is local (terraform.tfstate here, gitignored): fine for a first look, not for
# a shared environment.
#
# terraform {
#   backend "s3" {
#     bucket         = "srikit-tfstate-<account id>"
#     key            = "envs/staging/terraform.tfstate"
#     region         = "ap-south-1"
#     encrypt        = true
#     dynamodb_table = "srikit-tfstate-lock" # or, on Terraform 1.10+: use_lockfile = true (then the table is optional)
#   }
# }
