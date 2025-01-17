const path = require("path");
const execSync = require("child_process").execSync;
const { system, patching } = require("gluegun");
const { createApolloFetch } = require("apollo-fetch");

const Contract = artifacts.require("./Contract.sol");

const srcDir = path.join(__dirname, "..");

const httpPort = process.env.GRAPH_NODE_HTTP_PORT || 18000;
const indexPort = process.env.GRAPH_NODE_INDEX_PORT || 18030;

const fetchSubgraphs = createApolloFetch({
  uri: `http://localhost:${indexPort}/graphql`,
});
const fetchSubgraph = createApolloFetch({
  uri: `http://localhost:${httpPort}/subgraphs/name/test/derived-loaders`,
});

const exec = (cmd) => {
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};

const waitForSubgraphToBeSynced = async () =>
  new Promise((resolve, reject) => {
    // Wait for 60s
    let deadline = Date.now() + 60 * 1000;

    // Function to check if the subgraph is synced
    const checkSubgraphSynced = async () => {
      try {
        let result = await fetchSubgraphs({
          query: `{ indexingStatuses { synced, health } }`,
        });

        if (result.data.indexingStatuses[0].synced) {
          resolve();
        } else if (result.data.indexingStatuses[0].health != "healthy") {
          reject(new Error(`Subgraph failed`));
        } else {
          throw new Error("reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for the subgraph to sync`));
        } else {
          setTimeout(checkSubgraphSynced, 1000);
        }
      }
    };

    // Periodically check whether the subgraph has synced
    setTimeout(checkSubgraphSynced, 0);
  });

contract("Contract", (accounts) => {
  // Deploy the subgraph once before all tests
  before(async () => {
    // Deploy the contract
    const contract = await Contract.deployed();

    // Insert its address into subgraph manifest
    await patching.replace(
      path.join(srcDir, "subgraph.yaml"),
      "0x0000000000000000000000000000000000000000",
      contract.address
    );

    // Create and deploy the subgraph
    exec(`yarn codegen`);
    exec(`yarn create:test`);
    exec(`yarn deploy:test`);

    // Wait for the subgraph to be indexed
    await waitForSubgraphToBeSynced();
  });

  it("should return correct BFoos", async () => {
    let result = await fetchSubgraph({
      query: `{
        bfoos(orderBy: id) { id value bar { id } }
      }`,
    });

    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      bfoos: [
        {
          id: "0x30",
          value: "1",
          bar: { id: "0x31" },
        },
      ],
    });
  });


  it("should return correct Foos", async () => {
    let result = await fetchSubgraph({
      query: `{
        foos(orderBy: id) { id value bar { id } }
      }`,
    });

    expect(result.errors).to.be.undefined;
    expect(result.data).to.deep.equal({
      foos: [
        {
          id: "0",
          value: "1",
          bar: { id: "1" },
        },
      ],
    });
  });
});
