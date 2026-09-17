# Project deployment rule

For any production website update, commit the source changes and push them to this project's GitHub repository first. Wait for the GitHub-triggered Vercel deployment to become Ready, then verify the production site. Do not publish local working-tree changes directly with `vercel deploy --prod`. If GitHub push is unavailable, report the blocker and leave production unchanged.
