import { getPkgReleases } from '..';
import { Fixtures } from '../../../../test/fixtures';
import * as httpMock from '../../../../test/http-mock';
import * as hostRules from '../../../util/host-rules';
import { PypiDatasource } from '.';

const res1 = Fixtures.get('azure-cli-monitor.json');
const res2 = Fixtures.get('azure-cli-monitor-updated.json');
const htmlResponse = Fixtures.get('versions-html.html');
const badResponse = Fixtures.get('versions-html-badfile.html');
const dataRequiresPythonResponse = Fixtures.get(
  'versions-html-data-requires-python.html',
);
const mixedHyphensResponse = Fixtures.get('versions-html-mixed-hyphens.html');
const mixedCaseResponse = Fixtures.get('versions-html-mixed-case.html');
const withPeriodsResponse = Fixtures.get('versions-html-with-periods.html');
const withWhitespacesResponse = Fixtures.get(
  'versions-html-with-whitespaces.html',
);
const hyphensResponse = Fixtures.get('versions-html-hyphens.html');

const baseJsonUrl = 'https://pypi.org/pypi';
const baseSimpleUrl = 'https://pypi.org/simple';
const datasource = PypiDatasource.id;

describe('modules/datasource/pypi/index', () => {
  describe('getReleases', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
      delete process.env.PIP_INDEX_URL;
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('returns null for empty result', async () => {
      httpMock.scope(baseJsonUrl).get('/something/json').reply(200);
      httpMock.scope(baseSimpleUrl).get('/something/').reply(404);
      expect(
        await getPkgReleases({
          datasource,
          packageName: 'something',
        }),
      ).toBeNull();
    });

    it('returns null for 404', async () => {
      httpMock.scope(baseJsonUrl).get('/something/json').reply(404);
      httpMock.scope(baseSimpleUrl).get('/something/').reply(404);
      expect(
        await getPkgReleases({
          datasource,
          packageName: 'something',
        }),
      ).toBeNull();
    });

    it('processes real data', async () => {
      httpMock
        .scope(baseJsonUrl)
        .get('/azure-cli-monitor/json')
        .reply(200, res1);
      httpMock
        .scope(baseSimpleUrl)
        .get('/azure-cli-monitor/')
        .reply(200, htmlResponse);
      expect(
        await getPkgReleases({
          datasource,
          packageName: 'azure-cli-monitor',
        }),
      ).toMatchSnapshot();
    });

    it('supports custom datasource url', async () => {
      httpMock
        .scope('https://custom.pypi.net/foo')
        .get('/azure-cli-monitor/json')
        .reply(200, res1);
      httpMock
        .scope('https://custom.pypi.net/foo')
        .get('/azure-cli-monitor/')
        .reply(404);
      const config = {
        registryUrls: ['https://custom.pypi.net/foo'],
      };
      expect(
        await getPkgReleases({
          ...config,
          datasource,
          packageName: 'azure-cli-monitor',
        }),
      ).toMatchObject({
        registryUrl: 'https://custom.pypi.net/foo',
        releases: expect.toBeArrayOfSize(22),
        sourceUrl: 'https://github.com/Azure/azure-cli',
      });
    });

    it('sets private if authorization privided', async () => {
      hostRules.add({ matchHost: 'customprivate.pypi.net', token: '123test' });
      httpMock
        .scope('https://customprivate.pypi.net/foo')
        .get('/azure-cli-monitor/json')
        .reply(200, res1);
      httpMock
        .scope('https://customprivate.pypi.net/foo')
        .get('/azure-cli-monitor/')
        .reply(404);
      const config = {
        registryUrls: ['https://customprivate.pypi.net/foo'],
      };
      const res = await getPkgReleases({
        ...config,
        datasource,
        packageName: 'azure-cli-monitor',
      });
      expect(res?.isPrivate).toBeTrue();
    });

    it('supports multiple custom datasource urls', async () => {
      httpMock
        .scope('https://custom.pypi.net/foo')
        .get('/azure-cli-monitor/')
        .replyWithError('error');
      httpMock
        .scope('https://second-index/foo')
        .get('/azure-cli-monitor/json')
        .reply(200, res1);
      httpMock
        .scope('https://second-index/foo')
        .get('/azure-cli-monitor/')
        .reply(404);
      httpMock
        .scope('https://third-index/foo')
        .get('/azure-cli-monitor/json')
        .reply(200, res2);
      httpMock
        .scope('https://third-index/foo')
        .get('/azure-cli-monitor/')
        .reply(404);
      const config = {
        registryUrls: [
          'https://custom.pypi.net/foo',
          'https://second-index/foo',
          'https://third-index/foo',
        ],
      };
      const res = await getPkgReleases({
        ...config,
        datasource,
        packageName: 'azure-cli-monitor',
      });
      expect(res?.releases.pop()).toMatchObject({
        version: '0.2.15',
        releaseTimestamp: '2019-06-18T13:58:55.000Z',
      });
    });

    it('returns non-github home_page', async () => {
      httpMock
        .scope(baseJsonUrl)
        .get('/something/json')
        .reply(200, {
          ...JSON.parse(res1),
          info: {
            name: 'something',
            home_page: 'https://microsoft.com',
          },
        });
      httpMock.scope(baseSimpleUrl).get('/something/').reply(404);
      expect(
        (
          await getPkgReleases({
            datasource,
            packageName: 'something',
          })
        )?.homepage,
      ).toBe('https://microsoft.com');
    });

    it('find url from project_urls', async () => {
      const info = {
        name: 'flexget',
        home_page: 'https://flexget.com',
        project_urls: {
          Forum: 'https://discuss.flexget.com',
          Homepage: 'https://flexget.com',
          changelog: 'https://github.com/Flexget/wiki/blob/master/ChangeLog.md',
          'Issue Tracker': 'https://github.com/Flexget/Flexget/issues',
          Repository: 'https://github.com/Flexget/Flexget',
        },
      };
      httpMock
        .scope(baseJsonUrl)
        .get('/flexget/json')
        .reply(200, { ...JSON.parse(res1), info });
      httpMock.scope(baseSimpleUrl).get('/flexget/').reply(404);
      const result = await getPkgReleases({
        datasource,
        packageName: 'flexget',
      });
      expect(result?.sourceUrl).toBe(info.project_urls.Repository);
      expect(result?.changelogUrl).toBe(info.project_urls.changelog);
    });

    it('excludes gh sponsors url from project_urls', async () => {
      const info = {
        name: 'flexget',
        home_page: 'https://flexget.com',
        project_urls: {
          random: 'https://github.com/sponsors/Flexget',
        },
      };
      httpMock
        .scope(baseJsonUrl)
        .get('/flexget/json')
        .reply(200, { ...JSON.parse(res1), info });
      httpMock.scope(baseSimpleUrl).get('/flexget/').reply(404);
      const result = await getPkgReleases({
        datasource,
        packageName: 'flexget',
      });
      expect(result?.sourceUrl).toBeUndefined();
    });

    it('normalizes the package name according to PEP 503', async () => {
      const expectedHttpCall = httpMock
        .scope(baseJsonUrl)
        .get('/not-normalized-package/json')
        .reply(200, htmlResponse);
      httpMock
        .scope(baseSimpleUrl)
        .get('/not-normalized-package/')
        .reply(200, htmlResponse);

      await getPkgReleases({
        datasource,
        registryUrls: [baseJsonUrl],
        packageName: 'not_normalized.Package',
      });

      expect(expectedHttpCall.isDone()).toBeTrue();
    });

    it('normalizes the package name according to PEP 503 when falling back to simple endpoint', async () => {
      httpMock
        .scope(baseJsonUrl)
        .get('/not-normalized-package/json')
        .reply(404, '');
      const expectedFallbackHttpCall = httpMock
        .scope(baseSimpleUrl)
        .get('/not-normalized-package/')
        .reply(200, htmlResponse);

      await getPkgReleases({
        datasource,
        registryUrls: [baseJsonUrl],
        packageName: 'not_normalized.Package',
      });

      expect(expectedFallbackHttpCall.isDone()).toBeTrue();
    });

    it('normalizes the package name according to PEP 503 querying a simple endpoint', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      const expectedHttpCall = httpMock
        .scope(simpleRegistryUrl)
        .get('/not-normalized-package/')
        .reply(200, htmlResponse);
      httpMock
        .scope(simpleRegistryUrl)
        .get('/not-normalized-package/json')
        .reply(404);

      await getPkgReleases({
        datasource,
        registryUrls: [simpleRegistryUrl],
        packageName: 'not_normalized.Package',
      });

      expect(expectedHttpCall.isDone()).toBeTrue();
    });

    it('respects constraints', async () => {
      httpMock
        .scope(baseJsonUrl)
        .get('/doit/json')
        .reply(200, {
          info: {
            name: 'doit',
          },
          releases: {
            '0.30.3': [{ requires_python: null }],
            '0.31.0': [
              { requires_python: '>=3.4' },
              { requires_python: '>=2.7' },
            ],
            '0.31.1': [{ requires_python: '>=3.4' }],
            '0.4.0': [{ requires_python: '>=3.4' }, { requires_python: null }],
            '0.4.1': [],
          },
        });
      httpMock.scope(baseSimpleUrl).get('/doit/').reply(404);
      expect(
        await getPkgReleases({
          datasource,
          constraints: { python: '2.7' },
          packageName: 'doit',
          constraintsFiltering: 'strict',
        }),
      ).toMatchSnapshot();
    });

    it('process data from simple endpoint', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/dj-database-url/')
        .reply(200, htmlResponse);
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/json').reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'dj-database-url',
        }),
      ).toMatchSnapshot();
    });

    it('process data from +simple endpoint', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/+simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/dj-database-url/')
        .reply(200, htmlResponse);
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/json').reply(404);

      const config = {
        registryUrls: ['https://some.registry.org/+simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'dj-database-url',
        }),
      ).toMatchSnapshot();
    });

    it('sets private simple if authorization provided', async () => {
      const simpleRegistryUrl = 'https://some.private.registry.org/+simple/';
      hostRules.add({
        matchHost: 'some.private.registry.org',
        token: '123test',
      });
      httpMock
        .scope(simpleRegistryUrl)
        .get('/dj-database-url/')
        .reply(200, htmlResponse);
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/json').reply(404);
      const config = {
        registryUrls: ['https://some.private.registry.org/+simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        constraints: { python: '2.7' },
        packageName: 'dj-database-url',
      });
      expect(res?.isPrivate).toBeTrue();
    });

    it('process data from simple endpoint with hyphens', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/package-with-hyphens/')
        .reply(200, hyphensResponse);
      httpMock
        .scope(simpleRegistryUrl)
        .get('/package-with-hyphens/json')
        .reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        packageName: 'package--with-hyphens',
      });
      expect(res?.releases).toMatchObject([
        { version: '2.0.0' },
        { version: '2.0.1' },
        { version: '2.0.2' },
      ]);
    });

    it('process data from simple endpoint with hyphens replaced with underscores', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/image-collector/')
        .reply(200, mixedHyphensResponse);
      httpMock.scope(simpleRegistryUrl).get('/image-collector/json').reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'image-collector',
        }),
      ).toMatchSnapshot();
    });

    it('process data from simple endpoint with mixed-case characters', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/packagewithmixedcase/')
        .reply(200, mixedCaseResponse);
      httpMock
        .scope(simpleRegistryUrl)
        .get('/packagewithmixedcase/json')
        .reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        packageName: 'PackageWithMixedCase',
      });
      expect(res?.releases).toMatchObject([
        { version: '2.0.0' },
        { version: '2.0.1' },
        { version: '2.0.2' },
      ]);
    });

    it('process data from simple endpoint with mixed-case characters when using lower case dependency name', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/packagewithmixedcase/')
        .reply(200, mixedCaseResponse);
      httpMock
        .scope(simpleRegistryUrl)
        .get('/packagewithmixedcase/json')
        .reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        packageName: 'packagewithmixedcase',
      });
      expect(res?.releases).toMatchObject([
        { version: '2.0.0' },
        { version: '2.0.1' },
        { version: '2.0.2' },
      ]);
    });

    it('process data from simple endpoint with periods', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/package-with-periods/')
        .reply(200, withPeriodsResponse);
      httpMock
        .scope(simpleRegistryUrl)
        .get('/package-with-periods/json')
        .reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        packageName: 'package.with.periods',
      });
      expect(res?.releases).toMatchObject([
        { version: '2.0.0' },
        { version: '2.0.1' },
        { version: '2.0.2' },
      ]);
    });

    it('process data from simple endpoint with extra whitespaces in html', async () => {
      httpMock
        .scope('https://some.registry.org/simple/')
        .get('/package-with-whitespaces/')
        .reply(200, withWhitespacesResponse);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      const res = await getPkgReleases({
        datasource,
        ...config,
        packageName: 'package-with-whitespaces',
      });
      expect(res?.releases).toMatchObject([
        { version: '2.0.0' },
        { version: '2.0.1' },
        { version: '2.0.2' },
      ]);
    });

    it('returns null for empty response', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/').reply(200);
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/json').reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'dj-database-url',
        }),
      ).toBeNull();
    });

    it('returns null for 404 response from simple endpoint', async () => {
      httpMock
        .scope('https://some.registry.org/simple/')
        .get('/dj-database-url/')
        .replyWithError('error');
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'dj-database-url',
        }),
      ).toBeNull();
    });

    it('returns null for response with no versions', async () => {
      const simpleRegistryUrl = 'https://some.registry.org/simple/';
      httpMock
        .scope(simpleRegistryUrl)
        .get('/dj-database-url/')
        .reply(200, badResponse);
      httpMock.scope(simpleRegistryUrl).get('/dj-database-url/json').reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'dj-database-url',
        }),
      ).toBeNull();
    });

    it.each([404, 403])(
      'process data from simple api with pypijson unavailable',
      async (code: number) => {
        httpMock
          .scope('https://custom.pypi.net/foo')
          .get('/dj-database-url/json')
          .reply(code);
        httpMock
          .scope('https://custom.pypi.net/foo')
          .get('/dj-database-url/')
          .reply(200, htmlResponse);
        const config = {
          registryUrls: ['https://custom.pypi.net/foo'],
        };
        const result = await getPkgReleases({
          datasource,
          ...config,
          packageName: 'dj-database-url',
        });
        expect(result).toEqual({
          registryUrl: 'https://custom.pypi.net/foo',
          releases: [
            {
              version: '0.1.2',
            },
            {
              version: '0.1.3',
            },
            {
              version: '0.1.4',
            },
            {
              version: '0.2.0',
            },
            {
              version: '0.2.1',
            },
            {
              version: '0.2.2',
            },
            {
              version: '0.3.0',
            },
            {
              version: '0.4.0',
            },
            {
              version: '0.4.1',
            },
            {
              version: '0.4.2',
            },
            {
              isDeprecated: true,
              version: '0.5.0',
            },
          ],
        });
      },
    );

    it('parses data-requires-python and respects constraints from simple endpoint', async () => {
      httpMock
        .scope('https://some.registry.org/simple/')
        .get('/dj-database-url/')
        .reply(200, dataRequiresPythonResponse);
      httpMock
        .scope('https://some.registry.org/simple/')
        .get('/dj-database-url/json')
        .reply(404);
      const config = {
        registryUrls: ['https://some.registry.org/simple/'],
      };
      expect(
        await getPkgReleases({
          datasource,
          constraints: { python: '2.7' },
          ...config,
          packageName: 'dj-database-url',
          constraintsFiltering: 'strict',
        }),
      ).toMatchSnapshot();
    });
  });

  it.each([baseSimpleUrl, baseJsonUrl])(
    'uses https://pypi.org/pypi/ and https://pypi.org/simple/ (no find)',
    async (registry: string) => {
      httpMock
        .scope(baseJsonUrl)
        .get('/azure-cli-monitor/json')
        .reply(200, res1);
      httpMock
        .scope(baseSimpleUrl)
        .get('/azure-cli-monitor/')
        .reply(200, htmlResponse);
      const config = {
        registryUrls: [registry],
      };
      expect(
        await getPkgReleases({
          datasource,
          ...config,
          constraints: { python: '2.7' },
          packageName: 'azure-cli-monitor',
        }),
      ).toEqual({
        registryUrl: registry,
        releases: [
          {
            releaseTimestamp: '2017-04-03T16:55:14.000Z',
            version: '0.0.1',
          },
          {
            releaseTimestamp: '2017-04-17T20:32:30.000Z',
            version: '0.0.2',
          },
          {
            releaseTimestamp: '2017-04-28T21:18:54.000Z',
            version: '0.0.3',
          },
          {
            releaseTimestamp: '2017-05-09T21:36:51.000Z',
            version: '0.0.4',
          },
          {
            releaseTimestamp: '2017-05-30T23:13:49.000Z',
            version: '0.0.5',
          },
          {
            releaseTimestamp: '2017-06-13T22:21:05.000Z',
            version: '0.0.6',
          },
          {
            releaseTimestamp: '2017-06-21T22:12:36.000Z',
            version: '0.0.7',
          },
          {
            releaseTimestamp: '2017-07-07T16:22:26.000Z',
            version: '0.0.8',
          },
          {
            releaseTimestamp: '2017-08-28T20:14:33.000Z',
            version: '0.0.9',
          },
          {
            releaseTimestamp: '2017-09-22T23:47:59.000Z',
            version: '0.0.10',
          },
          {
            releaseTimestamp: '2017-10-24T02:14:07.000Z',
            version: '0.0.11',
          },
          {
            releaseTimestamp: '2017-11-14T18:31:57.000Z',
            version: '0.0.12',
          },
          {
            releaseTimestamp: '2017-12-05T18:57:54.000Z',
            version: '0.0.13',
          },
          {
            releaseTimestamp: '2018-01-05T21:26:03.000Z',
            version: '0.0.14',
          },
          {
            releaseTimestamp: '2018-01-17T18:36:39.000Z',
            version: '0.1.0',
          },
          {
            releaseTimestamp: '2018-01-31T18:05:22.000Z',
            version: '0.1.1',
          },
          {
            releaseTimestamp: '2018-02-13T18:17:52.000Z',
            version: '0.1.2',
          },
          {
            releaseTimestamp: '2018-03-13T17:08:20.000Z',
            version: '0.1.3',
          },
          {
            releaseTimestamp: '2018-03-27T17:55:25.000Z',
            version: '0.1.4',
          },
          {
            releaseTimestamp: '2018-04-10T17:25:47.000Z',
            version: '0.1.5',
          },
          {
            isDeprecated: true,
            releaseTimestamp: '2018-05-07T17:59:09.000Z',
            version: '0.1.6',
          },
          {
            releaseTimestamp: '2018-05-22T17:25:23.000Z',
            version: '0.1.7',
          },
        ],
        sourceUrl: 'https://github.com/Azure/azure-cli',
      });
    },
  );
});
