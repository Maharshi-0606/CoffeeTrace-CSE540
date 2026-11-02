// Tests for CoffeeTrace: the full farm-to-customer journey and every safety rule
// listed in the README. Run with:  npx hardhat test
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Status values, same order as the enum in ICoffeeTrace.sol
const Status = { Harvested: 0, Exported: 1, Roasted: 2, Sold: 3 };

describe("CoffeeTrace", function () {
  // Deploys the contract and gives each test account its role.
  async function deployFixture() {
    const [admin, farmer, exporter, roaster, retailer, certifier, oracle, customer, stranger] =
      await ethers.getSigners();

    const coffee = await ethers.deployContract("CoffeeTrace");

    await coffee.grantRole(await coffee.FARMER_ROLE(), farmer.address);
    await coffee.grantRole(await coffee.EXPORTER_ROLE(), exporter.address);
    await coffee.grantRole(await coffee.ROASTER_ROLE(), roaster.address);
    await coffee.grantRole(await coffee.RETAILER_ROLE(), retailer.address);
    await coffee.grantRole(await coffee.CERTIFIER_ROLE(), certifier.address);
    await coffee.grantRole(await coffee.ORACLE_ROLE(), oracle.address);

    return { coffee, admin, farmer, exporter, roaster, retailer, certifier, oracle, customer, stranger };
  }

  // Same as above, plus one batch registered by the farmer (batch ID 1).
  async function registeredBatchFixture() {
    const ctx = await deployFixture();
    const harvest = (await ethers.provider.getBlock("latest")).timestamp - 86400; // yesterday
    await ctx.coffee
      .connect(ctx.farmer)
      .registerBatch("Finca El Paraiso, Huila, Colombia", "2.1167,-75.8833", "Arabica", 500, harvest);
    return ctx;
  }

  describe("Product registration", function () {
    it("gives the first batch ID 1 and mints the token to the farmer", async function () {
      const { coffee, farmer } = await loadFixture(registeredBatchFixture);

      const batch = await coffee.getBatch(1);
      expect(batch.id).to.equal(1n);
      expect(batch.origin).to.equal("Finca El Paraiso, Huila, Colombia");
      expect(batch.geolocation).to.equal("2.1167,-75.8833");
      expect(batch.weightKg).to.equal(500n);
      expect(batch.status).to.equal(Status.Harvested);
      expect(batch.certified).to.equal(false);
      expect(await coffee.ownerOf(1)).to.equal(farmer.address);
      expect(await coffee.getCustodyHistory(1)).to.deep.equal([farmer.address]);
      expect(await coffee.totalBatches()).to.equal(1n);
    });

    it("emits BatchRegistered", async function () {
      const { coffee, farmer } = await loadFixture(deployFixture);
      await expect(coffee.connect(farmer).registerBatch("Huila", "2.1,-75.8", "Arabica", 500, 0))
        .to.emit(coffee, "BatchRegistered")
        .withArgs(1, farmer.address, "Huila", 500);
    });

    it("only lets a farmer register", async function () {
      const { coffee, stranger } = await loadFixture(deployFixture);
      await expect(coffee.connect(stranger).registerBatch("Huila", "2.1,-75.8", "Arabica", 500, 0))
        .to.be.revertedWithCustomError(coffee, "AccessControlUnauthorizedAccount");
    });

    it("rejects empty origin, empty geolocation, zero weight and a future harvest date", async function () {
      const { coffee, farmer } = await loadFixture(deployFixture);
      const tomorrow = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const f = coffee.connect(farmer);

      await expect(f.registerBatch("", "2.1,-75.8", "Arabica", 500, 0))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("origin is empty");
      await expect(f.registerBatch("Huila", "", "Arabica", 500, 0))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("geolocation is empty");
      await expect(f.registerBatch("Huila", "2.1,-75.8", "Arabica", 0, 0))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("weight must be > 0");
      await expect(f.registerBatch("Huila", "2.1,-75.8", "Arabica", 500, tomorrow))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("harvest date is in the future");
    });
  });

  describe("Full journey: farm -> exporter -> roaster -> retailer -> customer", function () {
    it("moves one batch through every stage and keeps the full history", async function () {
      const { coffee, farmer, exporter, roaster, retailer, certifier, oracle, customer } =
        await loadFixture(registeredBatchFixture);

      await expect(coffee.connect(farmer).transferBatch(1, exporter.address))
        .to.emit(coffee, "BatchTransferred").withArgs(1, farmer.address, exporter.address);
      await expect(coffee.connect(exporter).updateStatus(1, Status.Exported))
        .to.emit(coffee, "StatusUpdated").withArgs(1, Status.Exported, exporter.address);

      await expect(coffee.connect(oracle).recordCondition(1, 215, 605)).to.emit(coffee, "ConditionRecorded");
      await expect(coffee.connect(certifier).certifyBatch(1, "bafybeigdyrztexamplecid"))
        .to.emit(coffee, "BatchCertified").withArgs(1, certifier.address, "bafybeigdyrztexamplecid");

      await coffee.connect(exporter).transferBatch(1, roaster.address);
      await coffee.connect(roaster).updateStatus(1, Status.Roasted);
      await coffee.connect(roaster).transferBatch(1, retailer.address);
      await coffee.connect(retailer).updateStatus(1, Status.Sold);
      await coffee.connect(retailer).transferBatch(1, customer.address);

      const batch = await coffee.getBatch(1);
      expect(batch.status).to.equal(Status.Sold);
      expect(batch.certified).to.equal(true);
      expect(batch.certificateCID).to.equal("bafybeigdyrztexamplecid");
      expect(await coffee.ownerOf(1)).to.equal(customer.address);
      expect(await coffee.getCustodyHistory(1)).to.deep.equal([
        farmer.address, exporter.address, roaster.address, retailer.address, customer.address,
      ]);

      const readings = await coffee.getConditionReadings(1);
      expect(readings.length).to.equal(1);
      expect(readings[0].temperatureX10).to.equal(215n);
      expect(readings[0].humidityX10).to.equal(605n);
    });
  });

  describe("Custody transfer rules", function () {
    it("only lets the current owner transfer", async function () {
      const { coffee, exporter } = await loadFixture(registeredBatchFixture);
      await expect(coffee.connect(exporter).transferBatch(1, exporter.address))
        .to.be.revertedWithCustomError(coffee, "NotBatchOwner");
    });

    it("only allows the next role in the chain as the recipient", async function () {
      const { coffee, farmer, roaster, stranger } = await loadFixture(registeredBatchFixture);
      // a Harvested batch must go to an exporter, not straight to a roaster
      await expect(coffee.connect(farmer).transferBatch(1, roaster.address))
        .to.be.revertedWithCustomError(coffee, "InvalidRecipient").withArgs(roaster.address);
      await expect(coffee.connect(farmer).transferBatch(1, stranger.address))
        .to.be.revertedWithCustomError(coffee, "InvalidRecipient");
      await expect(coffee.connect(farmer).transferBatch(1, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(coffee, "InvalidRecipient");
    });

    it("blocks standard ERC-721 transfers so the role checks cannot be skipped", async function () {
      const { coffee, farmer, exporter } = await loadFixture(registeredBatchFixture);
      await expect(coffee.connect(farmer).transferFrom(farmer.address, exporter.address, 1))
        .to.be.revertedWithCustomError(coffee, "DirectTransferDisabled");
      await expect(
        coffee.connect(farmer)["safeTransferFrom(address,address,uint256)"](farmer.address, exporter.address, 1)
      ).to.be.revertedWithCustomError(coffee, "DirectTransferDisabled");
    });

    it("reverts for a batch that does not exist", async function () {
      const { coffee, farmer, exporter } = await loadFixture(registeredBatchFixture);
      await expect(coffee.connect(farmer).transferBatch(99, exporter.address))
        .to.be.revertedWithCustomError(coffee, "BatchDoesNotExist").withArgs(99);
      await expect(coffee.getBatch(0)).to.be.revertedWithCustomError(coffee, "BatchDoesNotExist");
    });
  });

  describe("Status update rules", function () {
    it("does not allow skipping a stage or going backwards", async function () {
      const { coffee, farmer, exporter } = await loadFixture(registeredBatchFixture);
      await coffee.connect(farmer).transferBatch(1, exporter.address);
      await expect(coffee.connect(exporter).updateStatus(1, Status.Roasted))
        .to.be.revertedWithCustomError(coffee, "InvalidStatusTransition")
        .withArgs(Status.Harvested, Status.Roasted);
      await expect(coffee.connect(exporter).updateStatus(1, Status.Harvested))
        .to.be.revertedWithCustomError(coffee, "InvalidStatusTransition");
    });

    it("requires the role that matches the new stage", async function () {
      const { coffee, farmer } = await loadFixture(registeredBatchFixture);
      // the farmer owns the batch but is not an exporter
      await expect(coffee.connect(farmer).updateStatus(1, Status.Exported))
        .to.be.revertedWithCustomError(coffee, "MissingRoleForStatus");
    });
  });

  describe("Certification and IoT readings", function () {
    it("only lets a certifier certify, and only once", async function () {
      const { coffee, certifier, stranger } = await loadFixture(registeredBatchFixture);
      await expect(coffee.connect(stranger).certifyBatch(1, "bafy-cid"))
        .to.be.revertedWithCustomError(coffee, "AccessControlUnauthorizedAccount");
      await expect(coffee.connect(certifier).certifyBatch(1, ""))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("CID is empty");
      await coffee.connect(certifier).certifyBatch(1, "bafy-cid");
      await expect(coffee.connect(certifier).certifyBatch(1, "bafy-cid-2"))
        .to.be.revertedWithCustomError(coffee, "AlreadyCertified").withArgs(1);
    });

    it("only lets the oracle record readings, with humidity between 0 and 100%", async function () {
      const { coffee, oracle, stranger } = await loadFixture(registeredBatchFixture);
      await expect(coffee.connect(stranger).recordCondition(1, 215, 605))
        .to.be.revertedWithCustomError(coffee, "AccessControlUnauthorizedAccount");
      await expect(coffee.connect(oracle).recordCondition(1, 215, 1001))
        .to.be.revertedWithCustomError(coffee, "InvalidInput").withArgs("humidity must be 0-100%");
      await coffee.connect(oracle).recordCondition(1, -15, 0); // -1.5 C is allowed
      expect((await coffee.getConditionReadings(1)).length).to.equal(1);
    });

    it("rejects readings after the batch is sold", async function () {
      const { coffee, farmer, exporter, roaster, retailer, oracle } = await loadFixture(registeredBatchFixture);
      await coffee.connect(farmer).transferBatch(1, exporter.address);
      await coffee.connect(exporter).updateStatus(1, Status.Exported);
      await coffee.connect(exporter).transferBatch(1, roaster.address);
      await coffee.connect(roaster).updateStatus(1, Status.Roasted);
      await coffee.connect(roaster).transferBatch(1, retailer.address);
      await coffee.connect(retailer).updateStatus(1, Status.Sold);
      await expect(coffee.connect(oracle).recordCondition(1, 215, 605))
        .to.be.revertedWithCustomError(coffee, "BatchAlreadySold").withArgs(1);
    });
  });

  describe("Interfaces", function () {
    it("reports support for ERC-721, AccessControl and ICoffeeTrace", async function () {
      const { coffee } = await loadFixture(deployFixture);
      expect(await coffee.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
      expect(await coffee.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
      const iface = await ethers.getContractAt("ICoffeeTrace", await coffee.getAddress());
      const fragments = iface.interface.fragments.filter((f) => f.type === "function");
      let id = 0n;
      for (const f of fragments) id ^= BigInt(f.selector);
      const icoffeeId = "0x" + id.toString(16).padStart(8, "0");
      expect(await coffee.supportsInterface(icoffeeId)).to.equal(true); // ICoffeeTrace
    });
  });
});
