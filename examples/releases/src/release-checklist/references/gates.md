# Release gates

| Gate        | Passes when                                                     |
| ----------- | --------------------------------------------------------------- |
| Tests       | CI is green on the release commit.                              |
| Changelog   | The release notes say what changes for users.                   |
| Rollback    | The previous live version is known and can be redeployed.       |
| Money paths | Any change to checkout or invoices has a reviewer from billing. |
